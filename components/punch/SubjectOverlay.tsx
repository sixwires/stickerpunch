"use client";

import { useEffect, useRef } from "react";

import { useWorkspace } from "@/lib/workspace/store";
import type { Subject } from "@/lib/segmentation/types";

const GLOW_BLUR_PX = 8;
const HOVER_OPACITY = 0.55;
const ACTIVE_OPACITY = 0.85;
const HOVER_TINT = "#7c3aed"; // violet-600
const ACTIVE_TINT = "#22c55e"; // green-500

export function SubjectOverlay() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visualCacheRef = useRef<Map<string, OffscreenCanvas>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;
    let raf = 0;

    const draw = () => {
      raf = 0;
      const state = useWorkspace.getState();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const seg = state.segmentation;
      if (!seg || !state.imageBitmap) return;
      const { transform } = state;
      const sourceScale = 1 / seg.scale; // working → source coords multiplier
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(transform.tx, transform.ty);
      ctx.scale(transform.scale * sourceScale, transform.scale * sourceScale);

      const cache = visualCacheRef.current;
      for (const subject of seg.subjects) {
        const isHover = state.hoverSubjectId === subject.id;
        const isActive = state.activeSubjectId === subject.id;
        if (!isHover && !isActive) continue;

        let patch = cache.get(subject.id);
        if (!patch) {
          patch = renderGlowPatch(subject);
          cache.set(subject.id, patch);
        }

        ctx.globalAlpha = isActive ? ACTIVE_OPACITY : HOVER_OPACITY;
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(
          patch,
          subject.bbox.x - GLOW_BLUR_PX,
          subject.bbox.y - GLOW_BLUR_PX,
        );
      }
      ctx.globalAlpha = 1;
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(draw);
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      schedule();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const unsubscribe = useWorkspace.subscribe((state, prev) => {
      if (state.segmentation !== prev.segmentation) {
        visualCacheRef.current.clear();
      }
      schedule();
    });

    const hitTest = (clientX: number, clientY: number): Subject | null => {
      const state = useWorkspace.getState();
      const seg = state.segmentation;
      if (!seg) return null;
      const rect = container.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const sx = (px - state.transform.tx) / state.transform.scale; // source coords
      const sy = (py - state.transform.ty) / state.transform.scale;
      // Convert source → working
      const wx = Math.round(sx * seg.scale);
      const wy = Math.round(sy * seg.scale);
      if (wx < 0 || wy < 0 || wx >= seg.width || wy >= seg.height) return null;
      // Iterate subjects (small N), check mask
      for (const subject of seg.subjects) {
        if (
          wx < subject.bbox.x ||
          wy < subject.bbox.y ||
          wx >= subject.bbox.x + subject.bbox.w ||
          wy >= subject.bbox.y + subject.bbox.h
        ) {
          continue;
        }
        const idx = wy * subject.maskWidth + wx;
        if (subject.mask[idx] >= 80) return subject;
      }
      return null;
    };

    const onPointerMove = (event: PointerEvent) => {
      const subject = hitTest(event.clientX, event.clientY);
      const state = useWorkspace.getState();
      const nextId = subject ? subject.id : null;
      if (state.hoverSubjectId !== nextId) state.setHoverSubject(nextId);
    };

    const onClick = (event: PointerEvent) => {
      const subject = hitTest(event.clientX, event.clientY);
      const state = useWorkspace.getState();
      state.setActiveSubject(subject ? subject.id : null);
    };

    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onClick);

    return () => {
      observer.disconnect();
      unsubscribe();
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onClick);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-auto"
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
    </div>
  );

  function renderGlowPatch(subject: Subject): OffscreenCanvas {
    const pad = GLOW_BLUR_PX;
    const w = subject.bbox.w + pad * 2;
    const h = subject.bbox.h + pad * 2;
    const tinted = new OffscreenCanvas(w, h);
    const tctx = tinted.getContext("2d");
    if (!tctx) return tinted;

    const imgData = tctx.createImageData(w, h);
    const isActive = useWorkspace.getState().activeSubjectId === subject.id;
    const tint = parseHex(isActive ? ACTIVE_TINT : HOVER_TINT);

    for (let y = 0; y < subject.bbox.h; y++) {
      for (let x = 0; x < subject.bbox.w; x++) {
        const srcX = subject.bbox.x + x;
        const srcY = subject.bbox.y + y;
        const srcIdx = srcY * subject.maskWidth + srcX;
        const alpha = subject.mask[srcIdx];
        if (alpha === 0) continue;
        const di = ((y + pad) * w + (x + pad)) * 4;
        imgData.data[di] = tint.r;
        imgData.data[di + 1] = tint.g;
        imgData.data[di + 2] = tint.b;
        imgData.data[di + 3] = alpha;
      }
    }
    tctx.putImageData(imgData, 0, 0);

    const blurred = new OffscreenCanvas(w, h);
    const bctx = blurred.getContext("2d");
    if (!bctx) return tinted;
    bctx.filter = `blur(${GLOW_BLUR_PX}px)`;
    bctx.drawImage(tinted, 0, 0);
    bctx.filter = "none";
    bctx.globalCompositeOperation = "source-over";
    bctx.drawImage(tinted, 0, 0);
    return blurred;
  }
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return { r, g, b };
}
