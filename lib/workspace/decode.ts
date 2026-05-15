"use client";

import exifr from "exifr";

export const MAX_BYTES = 12 * 1024 * 1024;
export const MAX_LONG_EDGE = 3072;

export const ACCEPTED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type AcceptedMime = (typeof ACCEPTED_MIME)[number];

const HEIC_MIME = new Set(["image/heic", "image/heif"]);

const ACCEPTED_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

export class DecodeError extends Error {
  readonly code:
    | "unsupported-type"
    | "too-large"
    | "heic-decode-failed"
    | "decode-failed";
  constructor(code: DecodeError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "DecodeError";
  }
}

export interface DecodeResult {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export function isAcceptedFile(file: File): boolean {
  if (ACCEPTED_MIME.includes(file.type as AcceptedMime)) return true;
  return ACCEPTED_EXT.test(file.name);
}

export async function decodeImage(file: File): Promise<DecodeResult> {
  if (!isAcceptedFile(file)) {
    throw new DecodeError(
      "unsupported-type",
      `Unsupported file type: ${file.type || file.name}`,
    );
  }
  if (file.size > MAX_BYTES) {
    throw new DecodeError(
      "too-large",
      `File is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB`,
    );
  }

  const isHeic =
    HEIC_MIME.has(file.type) || /\.(heic|heif)$/i.test(file.name);

  let source: Blob = file;
  if (isHeic) {
    try {
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({ blob: file, toType: "image/png" });
      source = Array.isArray(converted) ? converted[0] : converted;
    } catch (error: unknown) {
      throw new DecodeError(
        "heic-decode-failed",
        error instanceof Error ? error.message : "HEIC decode failed",
      );
    }
  }

  let orientation = 1;
  try {
    const parsed = await exifr.parse(file, { pick: ["Orientation"] });
    if (parsed && typeof parsed.Orientation === "number") {
      orientation = parsed.Orientation;
    }
  } catch {
    orientation = 1;
  }

  let raw: ImageBitmap;
  try {
    raw = await createImageBitmap(source);
  } catch (error: unknown) {
    throw new DecodeError(
      "decode-failed",
      error instanceof Error ? error.message : "Image decode failed",
    );
  }

  const oriented = applyOrientation(raw, orientation);
  raw.close();

  const scaled = downscale(oriented, MAX_LONG_EDGE);
  const bitmap = await createImageBitmap(scaled);
  return { bitmap, width: scaled.width, height: scaled.height };
}

function applyOrientation(bitmap: ImageBitmap, orientation: number): OffscreenCanvas {
  const swap = orientation >= 5 && orientation <= 8;
  const width = swap ? bitmap.height : bitmap.width;
  const height = swap ? bitmap.width : bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new DecodeError("decode-failed", "2D context unavailable");

  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, height, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, height, width);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, width);
      break;
    default:
      break;
  }

  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

function downscale(canvas: OffscreenCanvas, maxLongEdge: number): OffscreenCanvas {
  const longEdge = Math.max(canvas.width, canvas.height);
  if (longEdge <= maxLongEdge) return canvas;

  const scale = maxLongEdge / longEdge;
  const width = Math.round(canvas.width * scale);
  const height = Math.round(canvas.height * scale);
  const out = new OffscreenCanvas(width, height);
  const ctx = out.getContext("2d");
  if (!ctx) throw new DecodeError("decode-failed", "2D context unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, width, height);
  return out;
}
