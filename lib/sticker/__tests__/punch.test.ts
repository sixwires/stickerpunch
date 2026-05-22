import { describe, expect, it } from "vitest";

import { computeBBox, multiplyAlpha, padBBox } from "../punch";

describe("computeBBox", () => {
  it("returns null when no pixel exceeds the cutoff", () => {
    const alpha = new Uint8Array(64);
    expect(computeBBox(alpha, 8, 8, 4)).toBeNull();
  });

  it("finds the tightest rectangle around above-cutoff pixels", () => {
    const w = 10;
    const h = 6;
    const alpha = new Uint8Array(w * h);
    // mark a 3x2 block at (4,2)..(6,3)
    for (let y = 2; y <= 3; y++) {
      for (let x = 4; x <= 6; x++) alpha[y * w + x] = 200;
    }
    expect(computeBBox(alpha, w, h, 4)).toEqual({ x: 4, y: 2, w: 3, h: 2 });
  });

  it("ignores pixels below the cutoff", () => {
    const w = 8;
    const h = 8;
    const alpha = new Uint8Array(w * h);
    alpha[0] = 3; // below cutoff
    alpha[3 * w + 3] = 100;
    expect(computeBBox(alpha, w, h, 4)).toEqual({ x: 3, y: 3, w: 1, h: 1 });
  });
});

describe("padBBox", () => {
  it("expands and clamps to canvas bounds", () => {
    const box = { x: 5, y: 5, w: 10, h: 10 };
    const padded = padBBox(box, 20, 20, 8);
    expect(padded).toEqual({ x: 0, y: 0, w: 20, h: 20 });
  });

  it("preserves a centered box when margin fits", () => {
    const box = { x: 50, y: 50, w: 20, h: 20 };
    const padded = padBBox(box, 200, 200, 10);
    expect(padded).toEqual({ x: 40, y: 40, w: 40, h: 40 });
  });
});

describe("multiplyAlpha", () => {
  it("preserves saturated mask pixels and zeros unmasked ones", () => {
    const sw = 8;
    const sh = 8;
    const fullAlpha = new Uint8Array(sw * sh);
    // mask center pixel
    fullAlpha[4 * sw + 4] = 255;
    fullAlpha[4 * sw + 5] = 128;
    const box = { x: 3, y: 3, w: 4, h: 4 };
    const data = new Uint8ClampedArray(box.w * box.h * 4).fill(200); // opaque grey image
    multiplyAlpha(data, fullAlpha, sw, box);
    // pixel (4,4) source -> dest col=1,row=1
    const idx = (1 * box.w + 1) * 4;
    expect(data[idx + 3]).toBe(200); // 200 * 255/255
    // pixel (4,5) source -> dest col=2,row=1
    const idx2 = (1 * box.w + 2) * 4;
    expect(data[idx2 + 3]).toBe(Math.floor((200 * 128) / 255));
    // pixel outside mask
    const idx0 = 0;
    expect(data[idx0 + 3]).toBe(0);
  });
});
