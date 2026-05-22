import { describe, expect, it } from "vitest";

import { decodeSnapshot, encodeSnapshot, SnapshotStack } from "../snapshots";

function quantize(alpha: Uint8Array): Uint8Array {
  const out = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) {
    const level = alpha[i] >> 4;
    out[i] = level === 15 ? 255 : (level << 4) | level;
  }
  return out;
}

describe("encode/decodeSnapshot", () => {
  it("roundtrips an all-zero buffer", () => {
    const buf = new Uint8Array(1024);
    const enc = encodeSnapshot(buf);
    expect(enc.length).toBeLessThan(8);
    const dec = decodeSnapshot(enc, buf.length);
    expect(dec.length).toBe(buf.length);
    expect(dec.every((v) => v === 0)).toBe(true);
  });

  it("roundtrips with quantization-equivalent values", () => {
    const buf = new Uint8Array(256);
    for (let i = 0; i < buf.length; i++) buf[i] = i;
    const enc = encodeSnapshot(buf);
    const dec = decodeSnapshot(enc, buf.length);
    expect(Array.from(dec)).toEqual(Array.from(quantize(buf)));
  });

  it("compresses long runs efficiently", () => {
    const buf = new Uint8Array(100_000);
    buf.fill(255);
    const enc = encodeSnapshot(buf);
    // ~5 bytes max for one big run.
    expect(enc.length).toBeLessThan(8);
  });

  it("compresses a representative soft-mask shape better than 5x", () => {
    const w = 256;
    const h = 256;
    const buf = new Uint8Array(w * h);
    // Disc with feathered edge.
    const cx = w / 2;
    const cy = h / 2;
    const r = 80;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < r - 8) buf[y * w + x] = 255;
        else if (d < r) buf[y * w + x] = Math.round(((r - d) / 8) * 255);
        else buf[y * w + x] = 0;
      }
    }
    const enc = encodeSnapshot(buf);
    expect(buf.length / enc.length).toBeGreaterThan(5);
  });
});

describe("SnapshotStack", () => {
  it("bounds depth and clears redo on push", () => {
    const stack = new SnapshotStack(3);
    stack.push(new Uint8Array([1]));
    stack.push(new Uint8Array([2]));
    stack.push(new Uint8Array([3]));
    stack.push(new Uint8Array([4])); // evicts [1]
    expect(stack.canUndo()).toBe(true);

    const undone = stack.popUndo(new Uint8Array([5]));
    expect(Array.from(undone!)).toEqual([4]);
    expect(stack.canRedo()).toBe(true);

    // Pushing after popping clears the redo stack.
    stack.push(new Uint8Array([6]));
    expect(stack.canRedo()).toBe(false);
  });

  it("popUndo/popRedo round-trip", () => {
    const stack = new SnapshotStack();
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    stack.push(a);
    const undone = stack.popUndo(b);
    expect(undone).toEqual(a);
    const redone = stack.popRedo(a);
    expect(redone).toEqual(b);
  });

  it("returns null when stacks are empty", () => {
    const stack = new SnapshotStack();
    expect(stack.popUndo(new Uint8Array(1))).toBeNull();
    expect(stack.popRedo(new Uint8Array(1))).toBeNull();
  });
});
