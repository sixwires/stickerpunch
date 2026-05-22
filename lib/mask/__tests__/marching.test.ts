import { describe, expect, it } from "vitest";

import { extractRings } from "../marching";

function discMask(w: number, h: number, cx: number, cy: number, radius: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < radius - 2) out[y * w + x] = 255;
      else if (d < radius) out[y * w + x] = Math.round(((radius - d) / 2) * 255);
    }
  }
  return out;
}

describe("extractRings", () => {
  it("returns no rings for an empty mask", () => {
    const w = 64;
    const h = 64;
    const empty = new Uint8Array(w * h);
    expect(extractRings(empty, w, h)).toEqual([]);
  });

  it("returns no rings for a fully solid mask", () => {
    const w = 32;
    const h = 32;
    const full = new Uint8Array(w * h).fill(255);
    expect(extractRings(full, w, h)).toEqual([]);
  });

  it("traces a closed contour around a single disc", () => {
    const w = 128;
    const h = 128;
    const mask = discMask(w, h, w / 2, h / 2, 32);
    const rings = extractRings(mask, w, h, { maxEdge: 128, maxVerts: 256, minVerts: 4 });
    expect(rings.length).toBe(1);
    const pts = rings[0].points;
    // First and last vertices should be close (closed ring).
    const fx = pts[0];
    const fy = pts[1];
    const lx = pts[pts.length - 2];
    const ly = pts[pts.length - 1];
    expect(Math.hypot(fx - lx, fy - ly)).toBeLessThan(3);
    // Centroid should be near the disc center.
    let sumX = 0;
    let sumY = 0;
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      sumX += pts[i * 2];
      sumY += pts[i * 2 + 1];
    }
    expect(Math.abs(sumX / n - w / 2)).toBeLessThan(4);
    expect(Math.abs(sumY / n - h / 2)).toBeLessThan(4);
  });

  it("returns a separate ring per disjoint disc", () => {
    const w = 192;
    const h = 96;
    const m1 = discMask(w, h, 48, 48, 24);
    const m2 = discMask(w, h, 144, 48, 24);
    const combined = new Uint8Array(w * h);
    for (let i = 0; i < combined.length; i++) combined[i] = Math.max(m1[i], m2[i]);
    const rings = extractRings(combined, w, h, { maxEdge: 192, minVerts: 4 });
    expect(rings.length).toBe(2);
  });

  it("respects the maxVerts cap via RDP simplification", () => {
    const w = 256;
    const h = 256;
    const mask = discMask(w, h, w / 2, h / 2, 100);
    const rings = extractRings(mask, w, h, { maxEdge: 256, maxVerts: 32, minVerts: 4 });
    expect(rings.length).toBe(1);
    expect(rings[0].points.length / 2).toBeLessThanOrEqual(32);
  });
});
