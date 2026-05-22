import { describe, expect, it } from "vitest";

import { createSimplex } from "../noise";

describe("createSimplex", () => {
  it("is deterministic per seed", () => {
    const a = createSimplex(42);
    const b = createSimplex(42);
    for (let i = 0; i < 32; i++) {
      const v1 = a.noise3(i * 0.1, i * 0.2, i * 0.05);
      const v2 = b.noise3(i * 0.1, i * 0.2, i * 0.05);
      expect(v1).toBeCloseTo(v2, 10);
    }
  });

  it("differs between seeds", () => {
    const a = createSimplex(1);
    const b = createSimplex(2);
    let diffs = 0;
    for (let i = 0; i < 64; i++) {
      const t = i * 0.37 + 0.13;
      if (a.noise3(t, t * 1.7, t * 0.5) !== b.noise3(t, t * 1.7, t * 0.5)) diffs++;
    }
    expect(diffs).toBeGreaterThan(50);
  });

  it("stays within an approximately bounded range", () => {
    const noise = createSimplex(7);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 1000; i++) {
      const v = noise.noise3(Math.random() * 100, Math.random() * 100, Math.random() * 100);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeGreaterThan(-1.1);
    expect(max).toBeLessThan(1.1);
  });

  it("varies with time", () => {
    const noise = createSimplex(11);
    const a = noise.noise3(0.5, 0.5, 0);
    const b = noise.noise3(0.5, 0.5, 1);
    expect(a).not.toBe(b);
  });
});
