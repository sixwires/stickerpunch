"use client";

import { create } from "zustand";

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

export interface WorkspaceState {
  imageBitmap: ImageBitmap | null;
  source: SourceMeta | null;
  transform: Transform;
  stickers: DraftSticker[];
  setSource: (bitmap: ImageBitmap, meta: SourceMeta) => void;
  setTransform: (transform: Transform) => void;
  reset: () => void;
}

const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0 };

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  imageBitmap: null,
  source: null,
  transform: IDENTITY,
  stickers: [],
  setSource: (bitmap, meta) => {
    const previous = get().imageBitmap;
    if (previous && previous !== bitmap) {
      previous.close();
    }
    set({ imageBitmap: bitmap, source: meta, transform: IDENTITY });
  },
  setTransform: (transform) => set({ transform }),
  reset: () => {
    const previous = get().imageBitmap;
    if (previous) previous.close();
    set({ imageBitmap: null, source: null, transform: IDENTITY, stickers: [] });
  },
}));
