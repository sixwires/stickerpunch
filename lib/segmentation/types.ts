export interface SubjectBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Subject {
  id: string;
  /** Full-frame mask at working resolution: 0..255 per pixel, region == this subject only. */
  mask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  bbox: SubjectBBox;
  cx: number;
  cy: number;
  area: number;
  score: number;
}

export interface SegmentationResult {
  /** Working resolution actually used (post-downscale). */
  width: number;
  height: number;
  /** workingDim / sourceDim (uniform). */
  scale: number;
  /** Full-frame soft alpha 0..255 at working resolution. */
  softAlpha: Uint8Array;
  subjects: Subject[];
  backend: "webgpu" | "wasm";
}

export type ModelStatus =
  | { phase: "idle" }
  | { phase: "loading"; loaded: number; total: number | null }
  | { phase: "ready"; backend: "webgpu" | "wasm" }
  | { phase: "inferring" }
  | { phase: "error"; message: string };

export interface SegmentRequest {
  /** Source bitmap to segment. Transferred to worker. */
  bitmap: ImageBitmap;
  maxEdge?: number;
  minAreaFraction?: number;
}
