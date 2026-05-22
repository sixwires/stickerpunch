/**
 * Soft-edged alpha mask for the jelly tool.
 *
 * Stored as Uint8Array (0..255 per pixel) at a working resolution capped at
 * `WORKING_MAX_EDGE` long-edge px. The full-resolution composite happens at
 * punch time via `upsampleTo` which combines bilinear upsample + box blur so
 * edges remain soft regardless of source size.
 */

export const WORKING_MAX_EDGE = 1024;

export interface JellyMaskInit {
  /** Working-resolution width. */
  width: number;
  /** Working-resolution height. */
  height: number;
  /** Source image width — preserved so upsampleTo defaults match. */
  sourceWidth: number;
  /** Source image height. */
  sourceHeight: number;
  /** Optional initial alpha buffer; copied. Length must equal width*height. */
  alpha?: Uint8Array;
}

export type StampMode = "add" | "subtract";

export class JellyMask {
  readonly width: number;
  readonly height: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly alpha: Uint8Array;

  constructor(init: JellyMaskInit) {
    if (init.width <= 0 || init.height <= 0) {
      throw new Error("JellyMask requires positive dimensions");
    }
    this.width = init.width;
    this.height = init.height;
    this.sourceWidth = init.sourceWidth;
    this.sourceHeight = init.sourceHeight;
    const size = init.width * init.height;
    if (init.alpha) {
      if (init.alpha.length !== size) {
        throw new Error(
          `JellyMask alpha length ${init.alpha.length} != ${size}`,
        );
      }
      this.alpha = new Uint8Array(init.alpha);
    } else {
      this.alpha = new Uint8Array(size);
    }
  }

  /**
   * Build a JellyMask from a Subject mask. Downsamples to fit
   * WORKING_MAX_EDGE long edge using bilinear so soft edges survive.
   */
  static fromSubjectMask(params: {
    mask: Uint8Array;
    maskWidth: number;
    maskHeight: number;
    sourceWidth: number;
    sourceHeight: number;
    maxEdge?: number;
  }): JellyMask {
    const maxEdge = params.maxEdge ?? WORKING_MAX_EDGE;
    const longest = Math.max(params.maskWidth, params.maskHeight);
    const scale = longest <= maxEdge ? 1 : maxEdge / longest;
    const w = Math.max(1, Math.round(params.maskWidth * scale));
    const h = Math.max(1, Math.round(params.maskHeight * scale));
    const alpha =
      scale === 1
        ? new Uint8Array(params.mask)
        : bilinearResample(
            params.mask,
            params.maskWidth,
            params.maskHeight,
            w,
            h,
          );
    return new JellyMask({
      width: w,
      height: h,
      sourceWidth: params.sourceWidth,
      sourceHeight: params.sourceHeight,
      alpha,
    });
  }

  /** Blank mask sized to fit the given source within WORKING_MAX_EDGE. */
  static blankForSource(sourceWidth: number, sourceHeight: number): JellyMask {
    const longest = Math.max(sourceWidth, sourceHeight);
    const scale = longest <= WORKING_MAX_EDGE ? 1 : WORKING_MAX_EDGE / longest;
    const w = Math.max(1, Math.round(sourceWidth * scale));
    const h = Math.max(1, Math.round(sourceHeight * scale));
    return new JellyMask({
      width: w,
      height: h,
      sourceWidth,
      sourceHeight,
    });
  }

  clone(): JellyMask {
    return new JellyMask({
      width: this.width,
      height: this.height,
      sourceWidth: this.sourceWidth,
      sourceHeight: this.sourceHeight,
      alpha: this.alpha,
    });
  }

  clear(): void {
    this.alpha.fill(0);
  }

  /** Returns alpha in source-resolution space, length = sourceWidth*sourceHeight. */
  upsampleToSource(blurPx = 2): Uint8Array {
    return this.upsampleTo(this.sourceWidth, this.sourceHeight, blurPx);
  }

  upsampleTo(targetWidth: number, targetHeight: number, blurPx = 0): Uint8Array {
    const upsampled = bilinearResample(
      this.alpha,
      this.width,
      this.height,
      targetWidth,
      targetHeight,
    );
    if (blurPx > 0) boxBlurInPlace(upsampled, targetWidth, targetHeight, blurPx);
    return upsampled;
  }

  /**
   * Stamp a soft radial brush at working-resolution coords. `radius` is in
   * working pixels (full radius incl. feathered edge). `softness` 0..1 sets
   * the width of the feathered ring (0 = hard disc, 1 = full Gaussian fall).
   * `strength` 0..1 multiplies the brush alpha. Idempotent at the same point
   * once alpha saturates.
   */
  stamp(x: number, y: number, opts: StampOptions): void {
    const stamp = getStamp(opts.radius, opts.softness);
    const r = stamp.radius;
    const startX = Math.max(0, Math.floor(x - r));
    const endX = Math.min(this.width - 1, Math.ceil(x + r));
    const startY = Math.max(0, Math.floor(y - r));
    const endY = Math.min(this.height - 1, Math.ceil(y + r));
    if (startX > endX || startY > endY) return;

    const strength = clamp01(opts.strength);
    const dim = stamp.dim;
    const offsetX = x - r;
    const offsetY = y - r;
    const mode = opts.mode;

    for (let py = startY; py <= endY; py++) {
      const sy = Math.round(py - offsetY);
      if (sy < 0 || sy >= dim) continue;
      const rowMask = py * this.width;
      const rowStamp = sy * dim;
      for (let px = startX; px <= endX; px++) {
        const sx = Math.round(px - offsetX);
        if (sx < 0 || sx >= dim) continue;
        const s = stamp.data[rowStamp + sx];
        if (s === 0) continue;
        const idx = rowMask + px;
        const add = (s * strength) | 0;
        const current = this.alpha[idx];
        if (mode === "add") {
          const next = current + add;
          this.alpha[idx] = next > 255 ? 255 : next;
        } else {
          const next = current - add;
          this.alpha[idx] = next < 0 ? 0 : next;
        }
      }
    }
  }

  /** Box-blur the entire mask in place. */
  blur(radius: number): void {
    boxBlurInPlace(this.alpha, this.width, this.height, radius);
  }

  /**
   * Paint mask alpha into an RGBA buffer with given tint. `data` length must
   * equal width*height*4. Existing data is overwritten where mask is nonzero,
   * cleared elsewhere.
   */
  paintTinted(data: Uint8ClampedArray, tint: { r: number; g: number; b: number }): void {
    const size = this.width * this.height;
    if (data.length !== size * 4) {
      throw new Error(`paintTinted: data length mismatch (${data.length} vs ${size * 4})`);
    }
    for (let i = 0; i < size; i++) {
      const a = this.alpha[i];
      const di = i * 4;
      data[di] = tint.r;
      data[di + 1] = tint.g;
      data[di + 2] = tint.b;
      data[di + 3] = a;
    }
  }
}

export interface StampOptions {
  /** Brush radius in working pixels. */
  radius: number;
  /** 0 = hard disc, 1 = soft falloff across the whole radius. */
  softness: number;
  /** Per-stamp strength multiplier 0..1. */
  strength: number;
  mode: StampMode;
}

interface Stamp {
  radius: number;
  dim: number;
  data: Uint8Array;
}

const STAMP_CACHE = new Map<string, Stamp>();
const STAMP_CACHE_MAX = 16;

function getStamp(radius: number, softness: number): Stamp {
  const r = Math.max(1, Math.round(radius));
  const s = Math.round(clamp01(softness) * 100);
  const key = `${r}:${s}`;
  const cached = STAMP_CACHE.get(key);
  if (cached) {
    STAMP_CACHE.delete(key);
    STAMP_CACHE.set(key, cached);
    return cached;
  }
  const stamp = buildStamp(r, s / 100);
  if (STAMP_CACHE.size >= STAMP_CACHE_MAX) {
    const oldestKey = STAMP_CACHE.keys().next().value;
    if (oldestKey !== undefined) STAMP_CACHE.delete(oldestKey);
  }
  STAMP_CACHE.set(key, stamp);
  return stamp;
}

function buildStamp(radius: number, softness: number): Stamp {
  const dim = radius * 2 + 1;
  const data = new Uint8Array(dim * dim);
  const cx = radius;
  const cy = radius;
  const featherStart = radius * (1 - softness);
  const featherWidth = Math.max(1e-3, radius - featherStart);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= radius) continue;
      let v: number;
      if (d <= featherStart) {
        v = 1;
      } else {
        const t = (d - featherStart) / featherWidth;
        v = smoothstep(1 - t);
      }
      data[y * dim + x] = Math.round(v * 255);
    }
  }
  return { radius, dim, data };
}

function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Bilinear resample of an alpha buffer. */
export function bilinearResample(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return new Uint8Array(src);
  const out = new Uint8Array(dstW * dstH);
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dstW; x++) {
      const fx = (x + 0.5) * sx - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const wx = fx - x0;
      const a = src[y0 * srcW + x0];
      const b = src[y0 * srcW + x1];
      const c = src[y1 * srcW + x0];
      const d = src[y1 * srcW + x1];
      const top = a + (b - a) * wx;
      const bot = c + (d - c) * wx;
      out[y * dstW + x] = Math.round(top + (bot - top) * wy);
    }
  }
  return out;
}

/** Separable box blur (in-place via two scratch buffers). */
export function boxBlurInPlace(
  buf: Uint8Array,
  width: number,
  height: number,
  radius: number,
): void {
  if (radius < 1) return;
  const r = Math.max(1, Math.floor(radius));
  const scratch = new Uint8Array(buf.length);
  // horizontal
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = 0; x < r && x < width; x++) sum += buf[row + x];
    for (let x = 0; x < width; x++) {
      const add = x + r < width ? buf[row + x + r] : 0;
      const sub = x - r - 1 >= 0 ? buf[row + x - r - 1] : 0;
      sum += add - sub;
      const count = Math.min(width - 1, x + r) - Math.max(0, x - r) + 1;
      scratch[row + x] = Math.round(sum / count);
    }
  }
  // vertical
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < r && y < height; y++) sum += scratch[y * width + x];
    for (let y = 0; y < height; y++) {
      const add = y + r < height ? scratch[(y + r) * width + x] : 0;
      const sub = y - r - 1 >= 0 ? scratch[(y - r - 1) * width + x] : 0;
      sum += add - sub;
      const count = Math.min(height - 1, y + r) - Math.max(0, y - r) + 1;
      buf[y * width + x] = Math.round(sum / count);
    }
  }
}
