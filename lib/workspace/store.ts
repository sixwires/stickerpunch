"use client";

import { create } from "zustand";

import { JellyMask } from "@/lib/mask/JellyMask";
import { decodeSnapshot, encodeSnapshot, SnapshotStack } from "@/lib/mask/snapshots";
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

export type JellyTool = "add" | "subtract" | "lasso" | "erase";

export interface JellyState {
  mask: JellyMask;
  /** Monotonic version for cheap memo invalidation. */
  version: number;
  tool: JellyTool;
  /** Brush radius in working-resolution px. */
  brushSize: number;
  /** Softness 0..1. */
  softness: number;
  /** Per-stamp strength 0..1. */
  strength: number;
  canUndo: boolean;
  canRedo: boolean;
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

  jelly: JellyState | null;

  setSource: (bitmap: ImageBitmap, meta: SourceMeta) => void;
  setTransform: (transform: Transform) => void;
  setModelStatus: (status: ModelStatus) => void;
  setSegmentation: (result: SegmentationResult) => void;
  setHoverSubject: (id: string | null) => void;
  setActiveSubject: (id: string | null) => void;
  startJellyFromSubject: (subject: Subject) => void;
  startBlankJelly: () => void;
  exitJelly: () => void;
  setJellyTool: (tool: JellyTool) => void;
  setJellyBrush: (size: number, softness: number) => void;
  beginJellyStroke: () => void;
  bumpJellyVersion: () => void;
  undoJelly: () => void;
  redoJelly: () => void;
  reset: () => void;
}

const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0 };
const IDLE_STATUS: ModelStatus = { phase: "idle" };

const DEFAULT_BRUSH_SIZE = 28;
const DEFAULT_SOFTNESS = 0.65;
const DEFAULT_STRENGTH = 0.85;

/** SnapshotStack lives outside React state — mutable, large buffers. */
const snapshots = new SnapshotStack();

function snapshotJelly(jelly: JellyState): JellyState {
  return {
    ...jelly,
    canUndo: snapshots.canUndo(),
    canRedo: snapshots.canRedo(),
  };
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  imageBitmap: null,
  source: null,
  transform: IDENTITY,
  stickers: [],
  segmentation: null,
  modelStatus: IDLE_STATUS,
  hoverSubjectId: null,
  activeSubjectId: null,
  jelly: null,
  setSource: (bitmap, meta) => {
    const previous = get().imageBitmap;
    if (previous && previous !== bitmap) {
      previous.close();
    }
    snapshots.clear();
    set({
      imageBitmap: bitmap,
      source: meta,
      transform: IDENTITY,
      segmentation: null,
      hoverSubjectId: null,
      activeSubjectId: null,
      jelly: null,
    });
  },
  setTransform: (transform) => set({ transform }),
  setModelStatus: (status) => set({ modelStatus: status }),
  setSegmentation: (result) => {
    snapshots.clear();
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
      jelly: null,
    });
  },
  setHoverSubject: (id) => set({ hoverSubjectId: id }),
  setActiveSubject: (id) => set({ activeSubjectId: id }),
  startJellyFromSubject: (subject) => {
    const { source } = get();
    if (!source) return;
    const mask = JellyMask.fromSubjectMask({
      mask: subject.mask,
      maskWidth: subject.maskWidth,
      maskHeight: subject.maskHeight,
      sourceWidth: source.width,
      sourceHeight: source.height,
    });
    snapshots.clear();
    set({
      activeSubjectId: subject.id,
      jelly: {
        mask,
        version: 1,
        tool: "add",
        brushSize: DEFAULT_BRUSH_SIZE,
        softness: DEFAULT_SOFTNESS,
        strength: DEFAULT_STRENGTH,
        canUndo: false,
        canRedo: false,
      },
    });
  },
  startBlankJelly: () => {
    const { source } = get();
    if (!source) return;
    const mask = JellyMask.blankForSource(source.width, source.height);
    snapshots.clear();
    set({
      activeSubjectId: null,
      jelly: {
        mask,
        version: 1,
        tool: "add",
        brushSize: DEFAULT_BRUSH_SIZE,
        softness: DEFAULT_SOFTNESS,
        strength: DEFAULT_STRENGTH,
        canUndo: false,
        canRedo: false,
      },
    });
  },
  exitJelly: () => {
    snapshots.clear();
    set({ jelly: null, activeSubjectId: null });
  },
  setJellyTool: (tool) => {
    const { jelly } = get();
    if (!jelly) return;
    set({ jelly: { ...jelly, tool } });
  },
  setJellyBrush: (brushSize, softness) => {
    const { jelly } = get();
    if (!jelly) return;
    set({ jelly: { ...jelly, brushSize, softness } });
  },
  beginJellyStroke: () => {
    const { jelly } = get();
    if (!jelly) return;
    snapshots.push(encodeSnapshot(jelly.mask.alpha));
    set({ jelly: snapshotJelly(jelly) });
  },
  bumpJellyVersion: () => {
    const { jelly } = get();
    if (!jelly) return;
    set({ jelly: { ...jelly, version: jelly.version + 1 } });
  },
  undoJelly: () => {
    const { jelly } = get();
    if (!jelly) return;
    const current = encodeSnapshot(jelly.mask.alpha);
    const restored = snapshots.popUndo(current);
    if (!restored) return;
    const alpha = decodeSnapshot(restored, jelly.mask.alpha.length);
    jelly.mask.alpha.set(alpha);
    set({
      jelly: {
        ...jelly,
        version: jelly.version + 1,
        canUndo: snapshots.canUndo(),
        canRedo: snapshots.canRedo(),
      },
    });
  },
  redoJelly: () => {
    const { jelly } = get();
    if (!jelly) return;
    const current = encodeSnapshot(jelly.mask.alpha);
    const restored = snapshots.popRedo(current);
    if (!restored) return;
    const alpha = decodeSnapshot(restored, jelly.mask.alpha.length);
    jelly.mask.alpha.set(alpha);
    set({
      jelly: {
        ...jelly,
        version: jelly.version + 1,
        canUndo: snapshots.canUndo(),
        canRedo: snapshots.canRedo(),
      },
    });
  },
  reset: () => {
    const previous = get().imageBitmap;
    if (previous) previous.close();
    snapshots.clear();
    set({
      imageBitmap: null,
      source: null,
      transform: IDENTITY,
      stickers: [],
      segmentation: null,
      modelStatus: IDLE_STATUS,
      hoverSubjectId: null,
      activeSubjectId: null,
      jelly: null,
    });
  },
}));
