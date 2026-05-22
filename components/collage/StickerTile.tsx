"use client";

import { memo } from "react";

import type { Sticker } from "@/lib/storage/types";

export interface StickerTileProps {
  data: Sticker;
  width: number;
  index: number;
  onSelect: (sticker: Sticker) => void;
}

/** Deterministic rotation -8°..+8° seeded by the sticker id. */
function angleFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h % 1601) / 100 - 8);
}

export const StickerTile = memo(function StickerTile({
  data,
  width,
  index,
  onSelect,
}: StickerTileProps) {
  const aspect = data.height / Math.max(1, data.width);
  const height = Math.round(width * aspect);
  const angle = angleFor(data.id);

  return (
    <button
      type="button"
      onClick={() => onSelect(data)}
      className="group block w-full"
      style={{ transform: `rotate(${angle}deg)`, transformOrigin: "center" }}
      aria-label={`Sticker ${data.id}`}
    >
      {/* Blob/host URLs aren't supported by next/image; native img is required. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={data.url}
        alt=""
        width={data.width}
        height={data.height}
        loading={index < 12 ? "eager" : "lazy"}
        fetchPriority={index < 6 ? "high" : "low"}
        style={{ width: "100%", height: `${height}px`, objectFit: "contain" }}
        className="drop-shadow-md transition-transform group-hover:-translate-y-1 group-hover:drop-shadow-lg"
        draggable={false}
      />
    </button>
  );
});
