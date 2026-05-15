"use client";

import { Canvas } from "./Canvas";
import { Dropzone } from "./Dropzone";
import { useWorkspace } from "@/lib/workspace/store";

export function Workspace() {
  const imageBitmap = useWorkspace((s) => s.imageBitmap);
  const source = useWorkspace((s) => s.source);
  const reset = useWorkspace((s) => s.reset);

  if (!imageBitmap) return <Dropzone />;

  return (
    <div className="relative flex-1 flex flex-col">
      <Canvas />
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-3 pointer-events-none">
        <div className="rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-xs text-neutral-600 shadow-sm pointer-events-auto">
          {source?.fileName ?? "image"} · {imageBitmap.width}×{imageBitmap.height}
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-xs text-neutral-700 shadow-sm hover:bg-white pointer-events-auto transition-colors"
        >
          Replace image
        </button>
      </div>
    </div>
  );
}
