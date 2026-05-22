"use client";

import { useEffect, useState, useTransition } from "react";

import { hideSticker } from "@/app/actions/stickers";
import type { Sticker } from "@/lib/storage/types";

export interface StickerModalProps {
  sticker: Sticker;
  onClose: () => void;
}

export function StickerModal({ sticker, onClose }: StickerModalProps) {
  const [reported, setReported] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = sticker.url;
    a.download = `sticker-${sticker.id}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleReport = () => {
    if (reported || pending) return;
    startTransition(async () => {
      const res = await hideSticker(sticker.id, "user_report");
      if ("ok" in res && res.ok) setReported(true);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sticker detail"
    >
      <div
        className="relative max-w-3xl w-full bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 rounded-full bg-white/95 px-2.5 py-1 text-sm text-neutral-600 shadow hover:bg-white"
          aria-label="Close"
        >
          ✕
        </button>
        <div
          className="relative w-full"
          style={{
            backgroundImage:
              "linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)",
            backgroundSize: "20px 20px",
            backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
            aspectRatio: `${sticker.width} / ${sticker.height}`,
            maxHeight: "75vh",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sticker.url}
            alt=""
            className="absolute inset-0 h-full w-full object-contain p-6"
            draggable={false}
          />
        </div>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-neutral-200">
          <div className="text-xs text-neutral-500 tabular-nums">
            {sticker.width}×{sticker.height}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReport}
              disabled={reported || pending}
              className="rounded-full px-3 py-1.5 text-xs bg-neutral-100 text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 transition-colors"
            >
              {reported ? "Reported" : pending ? "Reporting…" : "Report"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-full px-4 py-1.5 text-sm bg-pink-500 text-white hover:bg-pink-600 transition-colors"
            >
              Download PNG
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
