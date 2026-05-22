import { describe, expect, it } from "vitest";

import { resampleStroke, type Point } from "../smoothing";

describe("resampleStroke", () => {
  it("returns [] for empty input", () => {
    expect(resampleStroke([])).toEqual([]);
  });

  it("returns the single point unchanged for length 1", () => {
    const r = resampleStroke([{ x: 5, y: 7 }]);
    expect(r).toEqual([{ x: 5, y: 7 }]);
  });

  it("densely samples a straight 2-point stroke at ~1 px", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 20, y: 0 };
    const r = resampleStroke([start, end], 1);
    // start always included
    expect(r[0]).toEqual(start);
    // many intermediate samples
    expect(r.length).toBeGreaterThanOrEqual(18);
    // last sample within 2 px of end
    const last = r[r.length - 1];
    expect(Math.abs(last.x - end.x)).toBeLessThan(2);
  });

  it("smooths a 3-point polyline without introducing huge jumps", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const r = resampleStroke(pts, 1);
    expect(r.length).toBeGreaterThan(20);
    // adjacent samples within ~2 px (resampling tolerance)
    for (let i = 1; i < r.length; i++) {
      const dx = r[i].x - r[i - 1].x;
      const dy = r[i].y - r[i - 1].y;
      const d = Math.hypot(dx, dy);
      expect(d).toBeLessThan(3);
    }
  });

  it("handles duplicate points without crashing", () => {
    const pts: Point[] = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    const r = resampleStroke(pts, 1);
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0]).toEqual({ x: 5, y: 5 });
  });
});
