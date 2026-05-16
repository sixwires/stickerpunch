"use client";

import { wrap, proxy } from "comlink";

import type { ModelStatus, SegmentRequest, SegmentationResult } from "./types";
import type { SegmentAPIType } from "@/workers/segment.worker";

interface SegmentClient {
  segment(req: SegmentRequest): Promise<SegmentationResult>;
  warmup(): Promise<ModelStatus>;
  onStatus(cb: (status: ModelStatus) => void): Promise<() => void>;
}

let client: SegmentClient | null = null;
let worker: Worker | null = null;

export function getSegmentClient(): SegmentClient {
  if (client) return client;
  if (typeof window === "undefined") {
    throw new Error("Segmentation client is browser-only");
  }
  worker = new Worker(new URL("../../workers/segment.worker.ts", import.meta.url), {
    type: "module",
    name: "stickerpunch-segment",
  });
  const api = wrap<SegmentAPIType>(worker);
  client = {
    segment: (req) => api.segment(req),
    warmup: () => api.warmup(),
    onStatus: async (cb) => {
      const release = await api.onStatus(proxy(cb));
      return () => {
        void release();
      };
    },
  };
  return client;
}

export function disposeSegmentClient() {
  worker?.terminate();
  worker = null;
  client = null;
}

export type { ModelStatus, SegmentRequest, SegmentationResult, Subject } from "./types";
