"use client";

import { useSyncExternalStore } from "react";

import { useWorkspace, type LocalSticker } from "@/lib/workspace/store";

export interface StickerCardProps {
  sticker: LocalSticker;
  /** Optional file name (without extension) for downloads. */
  fileName?: string;
}

export function StickerCard({ sticker, fileName = "sticker" }: StickerCardProps) {
  const removeSticker = useWorkspace((s) => s.removeSticker);
  const chromium = useChromium();

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = sticker.url;
    a.download = `${fileName}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    if (!chromium) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      "DownloadURL",
      `image/png:${fileName}.png:${absoluteUrl(sticker.url)}`,
    );
    event.dataTransfer.setData("text/uri-list", sticker.url);
  };

  return (
    <div
      className="group relative shrink-0 rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden"
      style={{ width: 144 }}
      draggable={chromium}
      onDragStart={handleDragStart}
      aria-label="Punched sticker"
    >
      <div
        className="relative h-32 w-full"
        style={{
          backgroundImage:
            "linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)",
          backgroundSize: "12px 12px",
          backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
        }}
      >
        {/* Blob URLs aren't supported by next/image; native img is required. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={sticker.url}
          alt=""
          className="absolute inset-0 h-full w-full object-contain drop-shadow-md"
          draggable={false}
        />
      </div>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
        <span className="text-[10px] text-neutral-500 tabular-nums">
          {sticker.width}×{sticker.height}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleDownload}
            className="rounded-full bg-pink-500 text-white text-xs px-2 py-0.5 hover:bg-pink-600 transition-colors"
          >
            Download
          </button>
          <button
            type="button"
            onClick={() => removeSticker(sticker.id)}
            className="rounded-full bg-neutral-100 text-neutral-600 text-xs px-1.5 py-0.5 hover:bg-neutral-200 transition-colors"
            aria-label="Remove sticker"
            title="Remove from tray"
          >
            ✕
          </button>
        </div>
      </div>
      {chromium ? (
        <div className="absolute inset-x-0 top-0 flex justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="mt-1 rounded-full bg-neutral-900/80 text-white text-[10px] px-2 py-0.5">
            Drag me to your desktop
          </span>
        </div>
      ) : null}
    </div>
  );
}

function useChromium(): boolean {
  return useSyncExternalStore(
    () => () => {},
    detectChromium,
    () => false,
  );
}

function detectChromium(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return false;
  const isSafari = /Safari\//.test(ua) && !/Chrom(e|ium)\//.test(ua) && !/Edg\//.test(ua);
  if (isSafari) return false;
  return /Chrom(e|ium)\/|Edg\/|OPR\/|Brave\//.test(ua);
}

function absoluteUrl(url: string): string {
  if (typeof location === "undefined") return url;
  try {
    return new URL(url, location.href).toString();
  } catch {
    return url;
  }
}
