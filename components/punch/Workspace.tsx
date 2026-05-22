"use client";

import { useCallback, useEffect, useState } from "react";

import { Canvas } from "./Canvas";
import { Dropzone } from "./Dropzone";
import { JellyEditor } from "./JellyEditor";
import { JellyToolbar } from "./JellyToolbar";
import { SubjectOverlay } from "./SubjectOverlay";
import { SplitTool } from "./SplitTool";
import { useWorkspace } from "@/lib/workspace/store";
import { getSegmentClient } from "@/lib/segmentation";
import type { Subject } from "@/lib/segmentation/types";

export function Workspace() {
  const imageBitmap = useWorkspace((s) => s.imageBitmap);
  const source = useWorkspace((s) => s.source);
  const reset = useWorkspace((s) => s.reset);
  const segmentation = useWorkspace((s) => s.segmentation);
  const modelStatus = useWorkspace((s) => s.modelStatus);
  const setModelStatus = useWorkspace((s) => s.setModelStatus);
  const setSegmentation = useWorkspace((s) => s.setSegmentation);
  const activeSubjectId = useWorkspace((s) => s.activeSubjectId);
  const jellyOpen = useWorkspace((s) => s.jelly !== null);
  const startJellyFromSubject = useWorkspace((s) => s.startJellyFromSubject);
  const startBlankJelly = useWorkspace((s) => s.startBlankJelly);

  const [splitMode, setSplitMode] = useState(false);

  // When a subject is clicked, downsample its mask into a JellyMask.
  useEffect(() => {
    if (!activeSubjectId || jellyOpen) return;
    const seg = useWorkspace.getState().segmentation;
    if (!seg) return;
    const subject: Subject | undefined = seg.subjects.find((s) => s.id === activeSubjectId);
    if (subject) startJellyFromSubject(subject);
  }, [activeSubjectId, jellyOpen, startJellyFromSubject]);

  useEffect(() => {
    if (!imageBitmap) return;
    let cancelled = false;
    let release: (() => void) | null = null;

    (async () => {
      const client = getSegmentClient();
      release = await client.onStatus((status) => {
        if (cancelled) return;
        setModelStatus(status);
      });
      // Clone the bitmap for the worker (current bitmap stays on main thread for canvas).
      const clone = await createImageBitmap(imageBitmap);
      try {
        const result = await client.segment({ bitmap: clone });
        if (cancelled) return;
        setSegmentation(result);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "segmentation failed";
        setModelStatus({ phase: "error", message });
      }
    })();

    return () => {
      cancelled = true;
      if (release) release();
    };
  }, [imageBitmap, setModelStatus, setSegmentation]);

  const handleSplitDone = useCallback(() => setSplitMode(false), []);

  if (!imageBitmap) return <Dropzone />;

  return (
    <div className="relative flex-1 flex flex-col">
      <Canvas />
      {!jellyOpen ? <SubjectOverlay /> : null}
      {!jellyOpen ? <SplitTool active={splitMode} onDone={handleSplitDone} /> : null}
      {jellyOpen ? <JellyEditor /> : null}
      {jellyOpen ? <JellyToolbar /> : null}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-3 pointer-events-none">
        <div className="rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-xs text-neutral-600 shadow-sm pointer-events-auto">
          {source?.fileName ?? "image"} · {imageBitmap.width}×{imageBitmap.height}
          {segmentation ? ` · ${segmentation.subjects.length} subjects` : ""}
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          {segmentation && !jellyOpen ? (
            <>
              <button
                type="button"
                onClick={() => setSplitMode((v) => !v)}
                className={`rounded-full px-3 py-1.5 text-xs shadow-sm transition-colors backdrop-blur ${
                  splitMode
                    ? "bg-pink-500 text-white hover:bg-pink-600"
                    : "bg-white/90 text-neutral-700 hover:bg-white"
                }`}
                aria-pressed={splitMode}
              >
                {splitMode ? "Cancel split" : "Split here"}
              </button>
              <button
                type="button"
                onClick={startBlankJelly}
                className="rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-xs text-neutral-700 shadow-sm hover:bg-white transition-colors"
              >
                Draw from scratch
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-xs text-neutral-700 shadow-sm hover:bg-white transition-colors"
          >
            Replace image
          </button>
        </div>
      </div>
      {!jellyOpen ? <ModelStatusBanner status={modelStatus} /> : null}
    </div>
  );
}

function ModelStatusBanner({ status }: { status: ReturnType<typeof useWorkspace.getState>["modelStatus"] }) {
  if (status.phase === "ready" || status.phase === "idle") return null;
  let label = "";
  let detail: string | null = null;
  if (status.phase === "loading") {
    const total = status.total;
    if (total && total > 0) {
      const pct = Math.min(100, Math.round((status.loaded / total) * 100));
      label = `Downloading punch model… ${pct}%`;
    } else {
      label = "Downloading punch model (one-time, ~25 MB)…";
    }
    detail = "Cached on reload.";
  } else if (status.phase === "inferring") {
    label = "Punching subjects out of the page…";
  } else if (status.phase === "error") {
    label = "Auto-detect failed";
    detail = status.message;
  }
  return (
    <div className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none">
      <div className="pointer-events-auto rounded-full bg-neutral-900/85 text-white px-4 py-2 text-xs shadow-lg backdrop-blur flex items-center gap-2">
        <span aria-live="polite">{label}</span>
        {detail ? <span className="text-neutral-300">· {detail}</span> : null}
      </div>
    </div>
  );
}
