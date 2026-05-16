/// <reference lib="webworker" />

import { expose } from "comlink";
import { env, pipeline, RawImage, type ProgressInfo } from "@huggingface/transformers";

import type { ModelStatus, SegmentRequest, SegmentationResult, Subject } from "@/lib/segmentation/types";
import { watershedSplit } from "@/lib/segmentation/watershedSplit";

// Allow remote model fetch; cache to Cache API (origin-persistent).
env.allowRemoteModels = true;
env.useBrowserCache = true;
// Disable FS paths inside browser worker (defensive — transformers auto-detects).
env.useFSCache = false;
env.allowLocalModels = false;

const MODEL_ID = "Xenova/modnet";
const DEFAULT_MAX_EDGE = 1536;
const DEFAULT_MIN_AREA_FRACTION = 0.005;

type SegPipeline = Awaited<ReturnType<typeof pipeline<"background-removal">>>;

interface WorkerState {
  segmenter: SegPipeline | null;
  backend: "webgpu" | "wasm" | null;
  loadingPromise: Promise<SegPipeline> | null;
}

const state: WorkerState = {
  segmenter: null,
  backend: null,
  loadingPromise: null,
};

type StatusListener = (status: ModelStatus) => void;
const statusListeners = new Set<StatusListener>();

function emit(status: ModelStatus) {
  for (const l of statusListeners) l(status);
}

async function ensureModel(): Promise<SegPipeline> {
  if (state.segmenter) return state.segmenter;
  if (state.loadingPromise) return state.loadingPromise;

  const probe = await detectWebGPU();
  const order: Array<"webgpu" | "wasm"> = probe ? ["webgpu", "wasm"] : ["wasm"];

  state.loadingPromise = (async () => {
    let lastError: unknown = null;
    for (const device of order) {
      try {
        emit({ phase: "loading", loaded: 0, total: null });
        const seg = await pipeline("background-removal", MODEL_ID, {
          device,
          dtype: device === "webgpu" ? "fp32" : "q8",
          progress_callback: (info: ProgressInfo) => {
            if (info.status === "progress") {
              const loaded = "loaded" in info && typeof info.loaded === "number" ? info.loaded : 0;
              const total = "total" in info && typeof info.total === "number" ? info.total : null;
              emit({ phase: "loading", loaded, total });
            }
          },
        });
        state.segmenter = seg;
        state.backend = device;
        emit({ phase: "ready", backend: device });
        return seg;
      } catch (err) {
        lastError = err;
      }
    }
    const message = lastError instanceof Error ? lastError.message : "model load failed";
    emit({ phase: "error", message });
    throw new Error(message);
  })();

  return state.loadingPromise;
}

async function detectWebGPU(): Promise<boolean> {
  const gpu = (globalThis.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } })
    .gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

function downscaleBitmap(
  bitmap: ImageBitmap,
  maxEdge: number,
): { canvas: OffscreenCanvas; width: number; height: number; scale: number } {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { canvas, width, height, scale };
}

async function bitmapToRawImage(bitmap: ImageBitmap, maxEdge: number) {
  const { canvas, width, height, scale } = downscaleBitmap(bitmap, maxEdge);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
  const imageData = ctx.getImageData(0, 0, width, height);
  const rgb = new Uint8ClampedArray(width * height * 3);
  for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
    rgb[j] = imageData.data[i];
    rgb[j + 1] = imageData.data[i + 1];
    rgb[j + 2] = imageData.data[i + 2];
  }
  const raw = new RawImage(rgb, width, height, 3);
  return { raw, width, height, scale };
}

function extractAlpha(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) out[j] = rgba[i + 3];
  return out;
}

function buildSubjectMask(
  softAlpha: Uint8Array,
  pixels: Uint32Array,
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const idx of pixels) mask[idx] = softAlpha[idx];
  return mask;
}

function meanAlpha(softAlpha: Uint8Array, pixels: Uint32Array): number {
  let sum = 0;
  for (const idx of pixels) sum += softAlpha[idx];
  return sum / (pixels.length * 255);
}

class SegmentAPI {
  onStatus(callback: StatusListener) {
    statusListeners.add(callback);
    return () => {
      statusListeners.delete(callback);
    };
  }

  async warmup(): Promise<ModelStatus> {
    try {
      await ensureModel();
      return { phase: "ready", backend: state.backend ?? "wasm" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "model load failed";
      return { phase: "error", message };
    }
  }

  async segment(req: SegmentRequest): Promise<SegmentationResult> {
    const maxEdge = req.maxEdge ?? DEFAULT_MAX_EDGE;
    const minAreaFraction = req.minAreaFraction ?? DEFAULT_MIN_AREA_FRACTION;

    const segmenter = await ensureModel();
    emit({ phase: "inferring" });

    const { raw, width, height, scale } = await bitmapToRawImage(req.bitmap, maxEdge);
    const output = await segmenter(raw);
    const rgba = (Array.isArray(output) ? output[0] : output) as RawImage;

    let softAlpha = extractAlpha(rgba.data as Uint8ClampedArray);
    if (rgba.width !== width || rgba.height !== height) {
      softAlpha = resizeAlpha(softAlpha, rgba.width, rgba.height, width, height);
    }

    const totalArea = width * height;
    const minArea = Math.max(64, Math.round(totalArea * minAreaFraction));
    const minSeedDistance = Math.max(8, Math.round(Math.sqrt(minArea) * 0.8));

    const ws = watershedSplit(softAlpha, width, height, { minArea, minSeedDistance });

    const subjects: Subject[] = ws.regions.map((region, i) => ({
      id: `s${i + 1}`,
      mask: buildSubjectMask(softAlpha, region.pixels, width, height),
      maskWidth: width,
      maskHeight: height,
      bbox: {
        x: region.bbox.minX,
        y: region.bbox.minY,
        w: region.bbox.maxX - region.bbox.minX + 1,
        h: region.bbox.maxY - region.bbox.minY + 1,
      },
      cx: region.cx,
      cy: region.cy,
      area: region.area,
      score: meanAlpha(softAlpha, region.pixels),
    }));

    emit({ phase: "ready", backend: state.backend ?? "wasm" });
    req.bitmap.close();
    return {
      width,
      height,
      scale,
      softAlpha,
      subjects,
      backend: state.backend ?? "wasm",
    };
  }
}

function resizeAlpha(
  src: Uint8Array,
  sw: number,
  sh: number,
  tw: number,
  th: number,
): Uint8Array {
  const out = new Uint8Array(tw * th);
  const fx = sw / tw;
  const fy = sh / th;
  for (let y = 0; y < th; y++) {
    const sy = Math.min(sh - 1, Math.floor(y * fy));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(sw - 1, Math.floor(x * fx));
      out[y * tw + x] = src[sy * sw + sx];
    }
  }
  return out;
}

expose(new SegmentAPI());

export type SegmentAPIType = SegmentAPI;
