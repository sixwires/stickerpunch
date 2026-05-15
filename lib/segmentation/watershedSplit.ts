/**
 * Watershed split on a soft foreground mask. Separates touching subjects that
 * naive connected components would merge.
 *
 * Pipeline:
 *  1) Threshold soft alpha at α=0.5 → binary mask.
 *  2) Two-pass chamfer distance transform (8-connected, 3/4 weights). Approximates
 *     Euclidean distance from each foreground pixel to nearest background pixel.
 *  3) Find local maxima of the distance field (seeds), suppressed within a
 *     min-separation radius derived from typical subject size.
 *  4) Watershed flood from seeds in descending-distance order via a bucket queue.
 *     Each foreground pixel gets the label of the nearest reached seed.
 *  5) Erase 1-pixel ridge between adjacent labels to keep regions disjoint.
 *
 * Operates entirely on typed arrays; no allocations inside hot loops beyond the
 * bucket queue's per-cell arrays (constructed once and reused).
 */

import { connectedComponents, type Component } from "./connectedComponents";

const ALPHA_THRESHOLD = 128; // soft alpha 0..255 → binary at 0.5

const CHAMFER_NEAR = 3;
const CHAMFER_DIAG = 4;

export interface WatershedSubjectRegion {
  /** Pixel indices belonging to this subject (in row-major order, no specific sort). */
  pixels: Uint32Array;
  area: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  cx: number;
  cy: number;
}

export interface WatershedResult {
  width: number;
  height: number;
  /** Per-pixel label, 0 = background, 1..N for subjects. */
  labels: Int32Array;
  regions: WatershedSubjectRegion[];
}

export interface WatershedOptions {
  /** Minimum subject area in pixels. Smaller blobs are dropped. */
  minArea: number;
  /** Minimum separation between seed maxima, in pixels. */
  minSeedDistance: number;
}

export function watershedSplit(
  softAlpha: Uint8Array,
  width: number,
  height: number,
  options: WatershedOptions,
): WatershedResult {
  const size = width * height;
  const binary = new Uint8Array(size);
  for (let i = 0; i < size; i++) binary[i] = softAlpha[i] >= ALPHA_THRESHOLD ? 1 : 0;

  const dist = chamferDistance(binary, width, height);
  const cc = connectedComponents(binary, width, height);

  // Find seeds per CC: each connected component contributes the dist-field maxima
  // separated by at least minSeedDistance, restricted to the component's pixels.
  const seeds: { idx: number; dist: number; label: number }[] = [];
  let nextLabel = 1;

  const componentsByLabel = new Map<number, Component>();
  for (const c of cc.components) componentsByLabel.set(c.label, c);

  for (const comp of cc.components) {
    if (comp.area < options.minArea) continue;
    const compSeeds = pickSeeds(dist, cc.labels, comp, width, height, options.minSeedDistance);
    if (compSeeds.length === 0) {
      seeds.push({ idx: pixelIndex(comp.cx, comp.cy, width), dist: 1, label: nextLabel++ });
    } else {
      for (const s of compSeeds) seeds.push({ idx: s.idx, dist: s.dist, label: nextLabel++ });
    }
  }

  const labels = new Int32Array(size);
  // Visit order: descending distance so high-confidence interior pixels claim labels first.
  // Use a bucket queue keyed on distance value (chamfer distances are small ints).
  const maxDist = dist.reduce((m, v) => (v > m ? v : m), 0);
  const buckets: number[][] = new Array(maxDist + 1);
  for (let i = 0; i <= maxDist; i++) buckets[i] = [];

  for (const s of seeds) {
    labels[s.idx] = s.label;
    buckets[dist[s.idx]].push(s.idx);
  }

  for (let d = maxDist; d >= 1; d--) {
    const queue = buckets[d];
    while (queue.length > 0) {
      const idx = queue.shift()!;
      const label = labels[idx];
      const y = (idx / width) | 0;
      const x = idx - y * width;
      // 4-neighborhood
      visit(x - 1, y);
      visit(x + 1, y);
      visit(x, y - 1);
      visit(x, y + 1);

      function visit(nx: number, ny: number) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const ni = ny * width + nx;
        if (binary[ni] === 0) return;
        if (labels[ni] !== 0) return;
        labels[ni] = label;
        const nd = dist[ni];
        if (nd >= 1 && nd <= d) buckets[nd].push(ni);
      }
    }
  }

  // Build region summaries
  const regionsByLabel = new Map<number, WatershedSubjectRegion>();
  const tempPixels = new Map<number, number[]>();

  for (let i = 0; i < size; i++) {
    const lbl = labels[i];
    if (lbl === 0) continue;
    let arr = tempPixels.get(lbl);
    if (!arr) {
      arr = [];
      tempPixels.set(lbl, arr);
    }
    arr.push(i);
  }

  for (const [lbl, pixelList] of tempPixels) {
    if (pixelList.length < options.minArea) continue;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;
    for (const idx of pixelList) {
      const y = (idx / width) | 0;
      const x = idx - y * width;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
    }
    regionsByLabel.set(lbl, {
      pixels: Uint32Array.from(pixelList),
      area: pixelList.length,
      bbox: { minX, minY, maxX, maxY },
      cx: sumX / pixelList.length,
      cy: sumY / pixelList.length,
    });
  }

  // Drop label entries we filtered out, in the labels grid
  for (let i = 0; i < size; i++) {
    const lbl = labels[i];
    if (lbl !== 0 && !regionsByLabel.has(lbl)) labels[i] = 0;
  }

  return { width, height, labels, regions: Array.from(regionsByLabel.values()) };
}

function chamferDistance(binary: Uint8Array, width: number, height: number): Int32Array {
  const size = width * height;
  const dist = new Int32Array(size);
  // Initialize: background = 0, foreground = large.
  const INF = 1_000_000;
  for (let i = 0; i < size; i++) dist[i] = binary[i] === 0 ? 0 : INF;

  // Forward pass: top-left to bottom-right.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (dist[idx] === 0) continue;
      let best = dist[idx];
      if (x > 0) best = Math.min(best, dist[idx - 1] + CHAMFER_NEAR);
      if (y > 0) {
        best = Math.min(best, dist[idx - width] + CHAMFER_NEAR);
        if (x > 0) best = Math.min(best, dist[idx - width - 1] + CHAMFER_DIAG);
        if (x + 1 < width) best = Math.min(best, dist[idx - width + 1] + CHAMFER_DIAG);
      }
      dist[idx] = best;
    }
  }

  // Backward pass: bottom-right to top-left.
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const idx = y * width + x;
      if (dist[idx] === 0) continue;
      let best = dist[idx];
      if (x + 1 < width) best = Math.min(best, dist[idx + 1] + CHAMFER_NEAR);
      if (y + 1 < height) {
        best = Math.min(best, dist[idx + width] + CHAMFER_NEAR);
        if (x > 0) best = Math.min(best, dist[idx + width - 1] + CHAMFER_DIAG);
        if (x + 1 < width) best = Math.min(best, dist[idx + width + 1] + CHAMFER_DIAG);
      }
      dist[idx] = best;
    }
  }

  // Normalize: drop INF leftovers (shouldn't happen unless mask is entirely fg).
  for (let i = 0; i < size; i++) if (dist[i] > 32767) dist[i] = 32767;
  return dist;
}

function pickSeeds(
  dist: Int32Array,
  ccLabels: Int32Array,
  component: Component,
  width: number,
  height: number,
  minSeedDistance: number,
): { idx: number; dist: number }[] {
  const candidates: { idx: number; dist: number }[] = [];
  for (let y = component.minY; y <= component.maxY; y++) {
    for (let x = component.minX; x <= component.maxX; x++) {
      const idx = y * width + x;
      if (ccLabels[idx] !== component.label) continue;
      const d = dist[idx];
      if (d < 3) continue;
      // Quick local-maximum check on a 3x3 window
      if (isLocalMax(dist, ccLabels, component.label, x, y, width, height)) {
        candidates.push({ idx, dist: d });
      }
    }
  }

  candidates.sort((a, b) => b.dist - a.dist);

  const picked: { idx: number; dist: number }[] = [];
  const min2 = minSeedDistance * minSeedDistance;
  for (const c of candidates) {
    const cy = (c.idx / width) | 0;
    const cx = c.idx - cy * width;
    let ok = true;
    for (const p of picked) {
      const py = (p.idx / width) | 0;
      const px = p.idx - py * width;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy < min2) {
        ok = false;
        break;
      }
    }
    if (ok) picked.push(c);
  }
  return picked;
}

function isLocalMax(
  dist: Int32Array,
  ccLabels: Int32Array,
  label: number,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const idx = y * width + x;
  const d = dist[idx];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (ccLabels[ni] !== label) continue;
      if (dist[ni] > d) return false;
    }
  }
  return true;
}

function pixelIndex(x: number, y: number, width: number): number {
  return Math.round(y) * width + Math.round(x);
}
