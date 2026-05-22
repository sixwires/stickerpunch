/**
 * Run-length encoded snapshots of a jelly mask for undo/redo.
 *
 * Alpha is quantized to 4 bits (16 levels) before RLE. This trades a small
 * amount of edge fidelity for ~5–20× compression on typical sticker masks
 * (large flat regions of 0 and ~255 with thin feathered borders). Acceptable
 * because the canonical working mask is always full-fidelity; snapshots only
 * dictate fidelity when the user undoes.
 *
 * Wire format:
 *   varint(count) byte(level0..15)   — repeated, no trailing terminator
 * Lengths are tracked separately by the caller (mask dimensions known).
 */

const MAX_STACK_DEPTH = 20;

/** Compress a mask alpha buffer (0..255) into an RLE snapshot. */
export function encodeSnapshot(alpha: Uint8Array): Uint8Array {
  if (alpha.length === 0) return new Uint8Array(0);
  // First pass: count runs to size the output exactly.
  const total = alpha.length;
  let runs = 1;
  let prev = alpha[0] >> 4;
  for (let i = 1; i < total; i++) {
    const q = alpha[i] >> 4;
    if (q !== prev) {
      runs++;
      prev = q;
    }
  }
  // Worst-case bound: 5 varint bytes (max for 32-bit count) + 1 level byte per run.
  const maxBytes = runs * 6;
  const out = new Uint8Array(maxBytes);
  let cursor = 0;

  prev = alpha[0] >> 4;
  let count = 1;
  for (let i = 1; i < total; i++) {
    const q = alpha[i] >> 4;
    if (q === prev) {
      count++;
      continue;
    }
    cursor = writeRun(out, cursor, count, prev);
    prev = q;
    count = 1;
  }
  cursor = writeRun(out, cursor, count, prev);
  return out.slice(0, cursor);
}

/** Decompress an RLE snapshot back into an alpha buffer of the given length. */
export function decodeSnapshot(snapshot: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let cursor = 0;
  let i = 0;
  while (cursor < snapshot.length && i < length) {
    const { value: count, next } = readVarint(snapshot, cursor);
    if (next >= snapshot.length) break;
    const level = snapshot[next] & 0x0f;
    cursor = next + 1;
    const alpha = level === 15 ? 255 : (level << 4) | level;
    const end = Math.min(length, i + count);
    out.fill(alpha, i, end);
    i = end;
  }
  return out;
}

function writeRun(out: Uint8Array, cursor: number, count: number, level: number): number {
  let c = cursor;
  let n = count;
  while (n >= 0x80) {
    out[c++] = (n & 0x7f) | 0x80;
    n >>>= 7;
  }
  out[c++] = n & 0x7f;
  out[c++] = level & 0x0f;
  return c;
}

function readVarint(buf: Uint8Array, cursor: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let c = cursor;
  while (c < buf.length) {
    const b = buf[c++];
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value, next: c };
    shift += 7;
    if (shift >= 35) break;
  }
  return { value, next: c };
}

/** Bounded undo/redo stack. Push a snapshot before each destructive op. */
export class SnapshotStack {
  private undo: Uint8Array[] = [];
  private redo: Uint8Array[] = [];

  constructor(private readonly maxDepth: number = MAX_STACK_DEPTH) {}

  push(snapshot: Uint8Array): void {
    this.undo.push(snapshot);
    if (this.undo.length > this.maxDepth) this.undo.shift();
    this.redo = [];
  }

  canUndo(): boolean {
    return this.undo.length > 0;
  }

  canRedo(): boolean {
    return this.redo.length > 0;
  }

  /**
   * Pop an undo entry. Caller passes the current snapshot (post-undo state's
   * "future") so we can push it to redo. Returns the snapshot to restore, or
   * null if no undo available.
   */
  popUndo(current: Uint8Array): Uint8Array | null {
    const prev = this.undo.pop();
    if (!prev) return null;
    this.redo.push(current);
    if (this.redo.length > this.maxDepth) this.redo.shift();
    return prev;
  }

  popRedo(current: Uint8Array): Uint8Array | null {
    const next = this.redo.pop();
    if (!next) return null;
    this.undo.push(current);
    if (this.undo.length > this.maxDepth) this.undo.shift();
    return next;
  }

  clear(): void {
    this.undo = [];
    this.redo = [];
  }

  /** Diagnostic: total bytes held in both stacks. */
  byteSize(): number {
    let total = 0;
    for (const s of this.undo) total += s.byteLength;
    for (const s of this.redo) total += s.byteLength;
    return total;
  }
}
