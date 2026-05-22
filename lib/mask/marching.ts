/**
 * Marching squares contour extraction for the jelly outline. Operates on a
 * downsampled copy of the mask so per-frame cost stays bounded on mid-tier
 * hardware. Output coordinates are returned in the input grid's pixel space;
 * callers upscale to working/source space as needed.
 *
 * The algorithm walks every 2x2 cell, classifies the corner-above-iso bitmask
 * (0..15), and emits 0..2 line segments per cell. Segments are then stitched
 * into closed rings by endpoint identity (interpolated points are identical
 * floats by construction at shared cell edges). Each ring is simplified with
 * Ramer-Douglas-Peucker to bound vertex count.
 */

import { bilinearResample } from "./JellyMask";

export interface Ring {
  /** Flat XY pairs: [x0, y0, x1, y1, ...]. Open ring; first==last implicit. */
  points: Float32Array;
}

export interface MarchOptions {
  /** Alpha threshold 0..255 (default 128 == iso 0.5). */
  iso?: number;
  /** Max long-edge resolution for the working downsample. */
  maxEdge?: number;
  /** Maximum vertices per ring after RDP simplify. */
  maxVerts?: number;
  /** RDP epsilon in downsampled-pixel units. */
  simplifyEpsilon?: number;
  /** Min ring length to keep (filters noise). */
  minVerts?: number;
}

interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * Extract simplified contour rings from an alpha mask. Coords are in the
 * input mask's pixel space (no downsample applied to the output).
 */
export function extractRings(
  alpha: Uint8Array,
  width: number,
  height: number,
  opts: MarchOptions = {},
): Ring[] {
  const iso = opts.iso ?? 128;
  const maxEdge = opts.maxEdge ?? 256;
  const maxVerts = opts.maxVerts ?? 256;
  const epsilon = opts.simplifyEpsilon ?? 0.75;
  const minVerts = opts.minVerts ?? 6;

  // Downsample for the marching pass; scale contour points back to input space.
  const longest = Math.max(width, height);
  const scale = longest <= maxEdge ? 1 : maxEdge / longest;
  const dw = Math.max(2, Math.round(width * scale));
  const dh = Math.max(2, Math.round(height * scale));
  const grid =
    scale === 1 ? alpha : bilinearResample(alpha, width, height, dw, dh);

  const segments = collectSegments(grid, dw, dh, iso);
  const rings = stitchRings(segments);
  const upscaleX = width / dw;
  const upscaleY = height / dh;

  const out: Ring[] = [];
  for (const ring of rings) {
    if (ring.length / 2 < minVerts) continue;
    const upscaled = upscaleAndSimplify(ring, upscaleX, upscaleY, epsilon, maxVerts);
    if (upscaled.length / 2 >= minVerts) out.push({ points: upscaled });
  }
  return out;
}

function collectSegments(
  grid: Uint8Array,
  w: number,
  h: number,
  iso: number,
): Segment[] {
  const segments: Segment[] = [];
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = grid[y * w + x];
      const tr = grid[y * w + x + 1];
      const br = grid[(y + 1) * w + x + 1];
      const bl = grid[(y + 1) * w + x];
      let code = 0;
      if (tl >= iso) code |= 8;
      if (tr >= iso) code |= 4;
      if (br >= iso) code |= 2;
      if (bl >= iso) code |= 1;
      if (code === 0 || code === 15) continue;

      const pairs = EDGE_PAIRS[code];
      for (let i = 0; i < pairs.length; i += 2) {
        const a = edgePoint(pairs[i], x, y, tl, tr, br, bl, iso);
        const b = edgePoint(pairs[i + 1], x, y, tl, tr, br, bl, iso);
        segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      }
    }
  }
  return segments;
}

// For each case 0..15, list of (edgeA, edgeB) pairs. Edges:
//   0=top, 1=right, 2=bottom, 3=left.
// Ambiguous saddles 5 and 10 use the "majority resolution" convention: split
// into two separate segments. The visual difference is minor at our scale.
const EDGE_PAIRS: number[][] = [
  [],
  [2, 3],
  [1, 2],
  [1, 3],
  [0, 1],
  [0, 3, 1, 2],
  [0, 2],
  [0, 3],
  [0, 3],
  [0, 2],
  [0, 1, 2, 3],
  [0, 1],
  [1, 3],
  [1, 2],
  [2, 3],
  [],
];

function edgePoint(
  edge: number,
  x: number,
  y: number,
  tl: number,
  tr: number,
  br: number,
  bl: number,
  iso: number,
): { x: number; y: number } {
  switch (edge) {
    case 0: {
      const t = interp(tl, tr, iso);
      return { x: x + t, y };
    }
    case 1: {
      const t = interp(tr, br, iso);
      return { x: x + 1, y: y + t };
    }
    case 2: {
      const t = interp(bl, br, iso);
      return { x: x + t, y: y + 1 };
    }
    case 3: {
      const t = interp(tl, bl, iso);
      return { x, y: y + t };
    }
    default:
      return { x, y };
  }
}

function interp(a: number, b: number, iso: number): number {
  const denom = b - a;
  if (denom === 0) return 0.5;
  const t = (iso - a) / denom;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function stitchRings(segments: Segment[]): number[][] {
  const map = new Map<string, number[]>();
  const key = (x: number, y: number): string => `${x.toFixed(4)}_${y.toFixed(4)}`;

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const ka = key(s.ax, s.ay);
    const kb = key(s.bx, s.by);
    if (!map.has(ka)) map.set(ka, []);
    if (!map.has(kb)) map.set(kb, []);
    map.get(ka)!.push(i);
    map.get(kb)!.push(i);
  }

  const used = new Uint8Array(segments.length);
  const rings: number[][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    const ring: number[] = [];
    let segIdx = i;
    let prevX = segments[segIdx].ax;
    let prevY = segments[segIdx].ay;
    ring.push(prevX, prevY);

    // Walk forward following endpoint adjacency.
    for (let safety = 0; safety < segments.length + 1; safety++) {
      used[segIdx] = 1;
      const seg = segments[segIdx];
      // Determine which endpoint of this segment is "next".
      const nextX = seg.ax === prevX && seg.ay === prevY ? seg.bx : seg.ax;
      const nextY = seg.ax === prevX && seg.ay === prevY ? seg.by : seg.ay;
      ring.push(nextX, nextY);

      const k = key(nextX, nextY);
      const adj = map.get(k);
      if (!adj) break;
      let found = -1;
      for (const candidate of adj) {
        if (candidate === segIdx) continue;
        if (used[candidate]) continue;
        found = candidate;
        break;
      }
      if (found === -1) break;
      segIdx = found;
      prevX = nextX;
      prevY = nextY;
    }

    if (ring.length / 2 >= 3) rings.push(ring);
  }
  return rings;
}

function upscaleAndSimplify(
  ring: number[],
  sx: number,
  sy: number,
  epsilon: number,
  maxVerts: number,
): Float32Array {
  // Scale into input space.
  const scaled: number[] = new Array(ring.length);
  for (let i = 0; i < ring.length; i += 2) {
    scaled[i] = ring[i] * sx;
    scaled[i + 1] = ring[i + 1] * sy;
  }

  // RDP simplify with a growing epsilon if still over budget.
  let eps = epsilon;
  let simplified = rdp(scaled, eps);
  while (simplified.length / 2 > maxVerts) {
    eps *= 1.5;
    simplified = rdp(scaled, eps);
    if (eps > 100) break;
  }
  return Float32Array.from(simplified);
}

/** Ramer-Douglas-Peucker on a flat [x,y,x,y,...] ring. */
function rdp(points: number[], epsilon: number): number[] {
  const n = points.length / 2;
  if (n < 3) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = -1;
    const ax = points[start * 2];
    const ay = points[start * 2 + 1];
    const bx = points[end * 2];
    const by = points[end * 2 + 1];
    for (let i = start + 1; i < end; i++) {
      const d = perpDistance(points[i * 2], points[i * 2 + 1], ax, ay, bx, by);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxDist > epsilon) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) {
      out.push(points[i * 2], points[i * 2 + 1]);
    }
  }
  return out;
}

function perpDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return Math.sqrt(ex * ex + ey * ey);
  }
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey);
}
