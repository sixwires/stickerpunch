"use client";

import { useWorkspace, type JellyTool } from "@/lib/workspace/store";

const TOOLS: { id: JellyTool; label: string; help: string }[] = [
  { id: "add", label: "Add", help: "Paint into mask" },
  { id: "subtract", label: "Subtract", help: "Paint out of mask" },
  { id: "erase", label: "Erase", help: "Hard subtract" },
  { id: "lasso", label: "Lasso", help: "Draw a closed shape" },
];

const MIN_BRUSH = 6;
const MAX_BRUSH = 120;

export function JellyToolbar() {
  const jelly = useWorkspace((s) => s.jelly);
  const setTool = useWorkspace((s) => s.setJellyTool);
  const setBrush = useWorkspace((s) => s.setJellyBrush);
  const undo = useWorkspace((s) => s.undoJelly);
  const redo = useWorkspace((s) => s.redoJelly);
  const exit = useWorkspace((s) => s.exitJelly);

  if (!jelly) return null;

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 rounded-2xl bg-white/95 backdrop-blur px-3 py-2 shadow-lg border border-neutral-200 pointer-events-auto"
      role="toolbar"
      aria-label="Jelly editor"
    >
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Jelly tool">
        {TOOLS.map((tool) => {
          const active = jelly.tool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTool(tool.id)}
              title={tool.help}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-pink-500 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              {tool.label}
            </button>
          );
        })}
      </div>

      <div className="h-6 w-px bg-neutral-200" aria-hidden="true" />

      <label className="flex items-center gap-2 text-xs text-neutral-700">
        <span className="select-none">Size</span>
        <input
          type="range"
          min={MIN_BRUSH}
          max={MAX_BRUSH}
          step={1}
          value={jelly.brushSize}
          onChange={(event) => setBrush(Number(event.currentTarget.value), jelly.softness)}
          className="w-24"
          aria-label="Brush size"
        />
        <span className="tabular-nums w-6 text-right">{jelly.brushSize}</span>
      </label>

      <label className="flex items-center gap-2 text-xs text-neutral-700">
        <span className="select-none">Soft</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(jelly.softness * 100)}
          onChange={(event) => setBrush(jelly.brushSize, Number(event.currentTarget.value) / 100)}
          className="w-24"
          aria-label="Brush softness"
        />
      </label>

      <div className="h-6 w-px bg-neutral-200" aria-hidden="true" />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={undo}
          disabled={!jelly.canUndo}
          className="rounded-full px-3 py-1 text-xs bg-neutral-100 text-neutral-700 hover:bg-neutral-200 disabled:opacity-40 disabled:hover:bg-neutral-100 transition-colors"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!jelly.canRedo}
          className="rounded-full px-3 py-1 text-xs bg-neutral-100 text-neutral-700 hover:bg-neutral-200 disabled:opacity-40 disabled:hover:bg-neutral-100 transition-colors"
        >
          Redo
        </button>
        <button
          type="button"
          onClick={exit}
          className="rounded-full px-3 py-1 text-xs bg-neutral-900 text-white hover:bg-neutral-800 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
