"use client";

import { create } from "zustand";

import type { ModelStatus, SegmentationResult, Subject } from "@/lib/segmentation/types";

export interface DraftSticker {
  id: string;
}

export interface SourceMeta {
  fileName: string;
  width: number;
  height: number;
  byteSize: number;
}

export interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

export interface SegmentationState {
  /** Working-resolution width/height. */
  width: number;
  height: number;
  /** workingDim / sourceDim. */
  scale: number;
  softAlpha: Uint8Array;
  subjects: Subject[];
  backend: "webgpu" | "wasm";
}

export interface WorkspaceState {
  imageBitmap: ImageBitmap | null;
  source: SourceMeta | null;
  transform: Transform;
  stickers: DraftSticker[];

  segmentation: SegmentationState | null;
  modelStatus: ModelStatus;
  hoverSubjectId: string | null;
  activeSubjectId: string | null;

  setSource: (bitmap: ImageBitmap, meta: SourceMeta) => void;
  setTransform: (transform: Transform) => void;
  setModelStatus: (status: ModelStatus) => void;
  setSegmentation: (result: SegmentationResult) => void;
  setHoverSubject: (id: string | null) => void;
  setActiveSubject: (id: string | null) => void;
  reset: () => void;
}

const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0 };
const IDLE_STATUS: ModelStatus = { phase: "idle" };

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  imageBitmap: null,
  source: null,
  transform: IDENTITY,
  stickers: [],
  segmentation: null,
  modelStatus: IDLE_STATUS,
  hoverSubjectId: null,
  activeSubjectId: null,
  setSource: (bitmap, meta) => {
    const previous = get().imageBitmap;
    if (previous && previous !== bitmap) {
      previous.close();
    }
    set({
      imageBitmap: bitmap,
      source: meta,
      transform: IDENTITY,
      segmentation: null,
      hoverSubjectId: null,
      activeSubjectId: null,
    });
  },
  setTransform: (transform) => set({ transform }),
  setModelStatus: (status) => set({ modelStatus: status }),
  setSegmentation: (result) =>
    set({
      segmentation: {
        width: result.width,
        height: result.height,
        scale: result.scale,
        softAlpha: result.softAlpha,
        subjects: result.subjects,
        backend: result.backend,
      },
      hoverSubjectId: null,
      activeSubjectId: null,
    }),
  setHoverSubject: (id) => set({ hoverSubjectId: id }),
  setActiveSubject: (id) => set({ activeSubjectId: id }),
  reset: () => {
    const previous = get().imageBitmap;
    if (previous) previous.close();
    set({
      imageBitmap: null,
      source: null,
      transform: IDENTITY,
      stickers: [],
      segmentation: null,
      modelStatus: IDLE_STATUS,
      hoverSubjectId: null,
      activeSubjectId: null,
    });
  },
}));
