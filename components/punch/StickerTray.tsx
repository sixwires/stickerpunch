"use client";

import { useWorkspace } from "@/lib/workspace/store";

import { StickerCard } from "./StickerCard";

export function StickerTray() {
  const stickers = useWorkspace((s) => s.stickers);
  const source = useWorkspace((s) => s.source);

  if (stickers.length === 0) return null;

  const baseName = source?.fileName.replace(/\.[^.]+$/, "") ?? "sticker";

  return (
    <div className="border-t border-neutral-200 bg-neutral-50">
      <div className="flex items-center gap-3 overflow-x-auto px-3 py-3">
        <span className="shrink-0 text-xs font-medium text-neutral-500">
          {stickers.length} sticker{stickers.length === 1 ? "" : "s"}
        </span>
        {stickers.map((sticker, index) => (
          <StickerCard
            key={sticker.id}
            sticker={sticker}
            fileName={`${baseName}-${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
