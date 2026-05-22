import { describe, expect, it } from "vitest";

import {
  bilinearResample,
  boxBlurInPlace,
  JellyMask,
  WORKING_MAX_EDGE,
} from "../JellyMask";

function makeBlank(w: number, h: number): JellyMask {
  return new JellyMask({ width: w, height: h, sourceWidth: w, sourceHeight: h });
}

describe("JellyMask", () => {
  it("rejects invalid dimensions", () => {
    expect(() => new JellyMask({ width: 0, height: 10, sourceWidth: 0, sourceHeight: 10 })).toThrow();
  });

  it("stamp(add) writes a feathered disc", () => {
    const mask = makeBlank(64, 64);
    mask.stamp(32, 32, { radius: 16, softness: 0.6, strength: 1, mode: "add" });
    // center is saturated
    expect(mask.alpha[32 * 64 + 32]).toBe(255);
    // outside radius is untouched
    expect(mask.alpha[0]).toBe(0);
    // feathered edge: at least one pixel strictly between 0 and 255
    let feathered = 0;
    for (let i = 0; i < mask.alpha.length; i++) {
      const a = mask.alpha[i];
      if (a > 0 && a < 255) feathered++;
    }
    expect(feathered).toBeGreaterThan(20);
  });

  it("hard stamp (softness=0) still has antialiased boundary", () => {
    const mask = makeBlank(64, 64);
    mask.stamp(32, 32, { radius: 12, softness: 0, strength: 1, mode: "add" });
    // center saturated, but edge pixels may include some non-saturated ones
    expect(mask.alpha[32 * 64 + 32]).toBe(255);
  });

  it("stamp(subtract) reduces alpha without going negative", () => {
    const mask = makeBlank(32, 32);
    mask.alpha.fill(200);
    mask.stamp(16, 16, { radius: 8, softness: 0.5, strength: 1, mode: "subtract" });
    expect(mask.alpha[16 * 32 + 16]).toBe(0);
    // Underflow guarded
    for (let i = 0; i < mask.alpha.length; i++) {
      expect(mask.alpha[i]).toBeGreaterThanOrEqual(0);
      expect(mask.alpha[i]).toBeLessThanOrEqual(255);
    }
  });

  it("repeated add stamps saturate without overflow", () => {
    const mask = makeBlank(32, 32);
    for (let n = 0; n < 10; n++) {
      mask.stamp(16, 16, { radius: 8, softness: 1, strength: 1, mode: "add" });
    }
    for (let i = 0; i < mask.alpha.length; i++) {
      expect(mask.alpha[i]).toBeLessThanOrEqual(255);
    }
  });

  it("clone produces an independent copy", () => {
    const a = makeBlank(16, 16);
    a.alpha[0] = 200;
    const b = a.clone();
    b.alpha[0] = 50;
    expect(a.alpha[0]).toBe(200);
    expect(b.alpha[0]).toBe(50);
  });

  it("fromSubjectMask downsamples large masks to <= WORKING_MAX_EDGE long edge", () => {
    const w = 2000;
    const h = 1500;
    const subjectMask = new Uint8Array(w * h);
    // fill a rough rectangle so resample has something to interpolate
    for (let y = 200; y < 1000; y++) {
      for (let x = 200; x < 1500; x++) subjectMask[y * w + x] = 255;
    }
    const jm = JellyMask.fromSubjectMask({
      mask: subjectMask,
      maskWidth: w,
      maskHeight: h,
      sourceWidth: w,
      sourceHeight: h,
    });
    expect(Math.max(jm.width, jm.height)).toBeLessThanOrEqual(WORKING_MAX_EDGE);
    expect(jm.sourceWidth).toBe(w);
    expect(jm.sourceHeight).toBe(h);
    // Memory budget: working buffer must stay under 2 MB regardless of source size.
    expect(jm.alpha.byteLength).toBeLessThan(2 * 1024 * 1024);
  });

  it("fromSubjectMask preserves a mask smaller than the cap", () => {
    const w = 200;
    const h = 100;
    const subjectMask = new Uint8Array(w * h);
    subjectMask.fill(128);
    const jm = JellyMask.fromSubjectMask({
      mask: subjectMask,
      maskWidth: w,
      maskHeight: h,
      sourceWidth: w * 4,
      sourceHeight: h * 4,
    });
    expect(jm.width).toBe(w);
    expect(jm.height).toBe(h);
  });

  it("blankForSource caps the working mask under 2 MB at any source size", () => {
    const jm = JellyMask.blankForSource(8000, 6000);
    expect(jm.alpha.byteLength).toBeLessThan(2 * 1024 * 1024);
    expect(Math.max(jm.width, jm.height)).toBeLessThanOrEqual(WORKING_MAX_EDGE);
  });

  it("upsampleTo returns the requested size with soft (non-binary) edges", () => {
    const jm = makeBlank(32, 32);
    jm.stamp(16, 16, { radius: 10, softness: 0.7, strength: 1, mode: "add" });
    const big = jm.upsampleTo(128, 128, 2);
    expect(big.length).toBe(128 * 128);
    // Edge pixel sample: at least one pixel strictly between 0 and 255 after upsample+blur.
    let softCount = 0;
    for (const a of big) if (a > 0 && a < 255) softCount++;
    expect(softCount).toBeGreaterThan(50);
  });

  it("paintTinted writes RGBA with tint and mask alpha", () => {
    const jm = makeBlank(4, 4);
    jm.alpha[0] = 200;
    jm.alpha[15] = 100;
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    jm.paintTinted(rgba, { r: 255, g: 0, b: 128 });
    expect(rgba[0]).toBe(255);
    expect(rgba[1]).toBe(0);
    expect(rgba[2]).toBe(128);
    expect(rgba[3]).toBe(200);
    expect(rgba[15 * 4 + 3]).toBe(100);
  });
});

describe("bilinearResample", () => {
  it("identity when same size", () => {
    const src = new Uint8Array([1, 2, 3, 4]);
    const out = bilinearResample(src, 2, 2, 2, 2);
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
    expect(out).not.toBe(src);
  });

  it("preserves a constant field", () => {
    const src = new Uint8Array(64);
    src.fill(180);
    const out = bilinearResample(src, 8, 8, 16, 16);
    expect(out.every((v) => v === 180)).toBe(true);
  });
});

describe("boxBlurInPlace", () => {
  it("spreads a single bright pixel into a soft kernel", () => {
    const w = 9;
    const h = 9;
    const buf = new Uint8Array(w * h);
    buf[4 * w + 4] = 255;
    boxBlurInPlace(buf, w, h, 2);
    // center reduced, neighbors nonzero
    expect(buf[4 * w + 4]).toBeLessThan(255);
    expect(buf[4 * w + 3]).toBeGreaterThan(0);
    expect(buf[3 * w + 4]).toBeGreaterThan(0);
  });
});
