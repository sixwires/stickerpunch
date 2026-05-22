/**
 * Punch a sticker: composite (source × upsampled mask) into a new image,
 * cropped to the mask bounding box + margin, output as a PNG blob with
 * transparency.
 *
 * Edge softness is preserved by upsampling the working-res mask to source
 * resolution with a small box blur before multiplying into the source RGB.
 */

import type { JellyMask } from "@/lib/mask/JellyMask";

export interface PunchOptions {
  /** Source image at full resolution. */
  source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
  sourceWidth: number;
  sourceHeight: number;
  /** Jelly mask whose source dimensions match the source. */
  mask: JellyMask;
  /** Padding (source px) added around the mask bounding box. */
  margin?: number;
  /** Alpha cutoff (0..255) for bbox detection. */
  alphaCutoff?: number;
  /** Box-blur radius applied after upsampling the mask, in source px. */
  upsampleBlur?: number;
}

export interface PunchedSticker {
  blob: Blob;
  width: number;
  height: number;
  /** Source-space bounding box used to crop the sticker. */
  bbox: { x: number; y: number; w: number; h: number };
}

const DEFAULT_MARGIN = 24;
const DEFAULT_ALPHA_CUTOFF = 4;
const DEFAULT_UPSAMPLE_BLUR = 2;

export async function punchSticker(opts: PunchOptions): Promise<PunchedSticker> {
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const alphaCutoff = opts.alphaCutoff ?? DEFAULT_ALPHA_CUTOFF;
  const blur = opts.upsampleBlur ?? DEFAULT_UPSAMPLE_BLUR;

  // Upsample mask to source resolution with soft edges preserved.
  const fullAlpha = opts.mask.upsampleTo(opts.sourceWidth, opts.sourceHeight, blur);
  const bbox = computeBBox(fullAlpha, opts.sourceWidth, opts.sourceHeight, alphaCutoff);
  if (!bbox) {
    throw new Error("Cannot punch: mask is empty");
  }
  const padded = padBBox(bbox, opts.sourceWidth, opts.sourceHeight, margin);

  const canvas = createCanvas(padded.w, padded.h);
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("Cannot punch: 2d context unavailable");

  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    opts.source as CanvasImageSource,
    padded.x,
    padded.y,
    padded.w,
    padded.h,
    0,
    0,
    padded.w,
    padded.h,
  );

  const imageData = ctx.getImageData(0, 0, padded.w, padded.h);
  multiplyAlpha(imageData.data, fullAlpha, opts.sourceWidth, padded);
  ctx.putImageData(imageData, 0, 0);

  const blob = await toBlob(canvas);
  return {
    blob,
    width: padded.w,
    height: padded.h,
    bbox: padded,
  };
}

/** Tightest bounding box around alpha > cutoff, or null when empty. */
export function computeBBox(
  alpha: Uint8Array,
  width: number,
  height: number,
  cutoff: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let rowMinX = -1;
    let rowMaxX = -1;
    for (let x = 0; x < width; x++) {
      if (alpha[rowOffset + x] > cutoff) {
        if (rowMinX === -1) rowMinX = x;
        rowMaxX = x;
      }
    }
    if (rowMinX !== -1) {
      if (rowMinX < minX) minX = rowMinX;
      if (rowMaxX > maxX) maxX = rowMaxX;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Pad and clamp a bbox to the source canvas. */
export function padBBox(
  bbox: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
  margin: number,
): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, bbox.x - margin);
  const y = Math.max(0, bbox.y - margin);
  const right = Math.min(width, bbox.x + bbox.w + margin);
  const bot = Math.min(height, bbox.y + bbox.h + margin);
  return { x, y, w: right - x, h: bot - y };
}

/**
 * Multiply per-pixel RGBA in `data` by the soft mask alpha within `box`.
 * `fullAlpha` is the source-resolution mask alpha; `box` is the crop window.
 */
export function multiplyAlpha(
  data: Uint8ClampedArray,
  fullAlpha: Uint8Array,
  sourceWidth: number,
  box: { x: number; y: number; w: number; h: number },
): void {
  for (let row = 0; row < box.h; row++) {
    const dstRow = row * box.w;
    const srcRow = (box.y + row) * sourceWidth + box.x;
    for (let col = 0; col < box.w; col++) {
      const di = (dstRow + col) * 4;
      const a = fullAlpha[srcRow + col];
      // Compose with any existing alpha (e.g. source image with transparency).
      const existing = data[di + 3];
      data[di + 3] = (existing * a) / 255;
    }
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

async function toBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode PNG"));
    }, "image/png");
  });
}
