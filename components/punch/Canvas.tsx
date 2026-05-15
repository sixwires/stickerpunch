"use client";

import { useEffect, useRef } from "react";
import { useWorkspace, type Transform } from "@/lib/workspace/store";

const MIN_SCALE = 0.05;
const MAX_SCALE = 16;
const ZOOM_STEP = 1.0015;

export function Canvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;
    let didFit = false;

    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const { imageBitmap, transform } = useWorkspace.getState();
      if (!imageBitmap) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(transform.tx, transform.ty);
      ctx.scale(transform.scale, transform.scale);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(imageBitmap, 0, 0);
    };

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const state = useWorkspace.getState();
      if (state.imageBitmap && !didFit && rect.width > 0 && rect.height > 0) {
        didFit = true;
        state.setTransform(fitTransform(state.imageBitmap, rect.width, rect.height));
        return;
      }
      draw();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const unsubscribe = useWorkspace.subscribe((state, prev) => {
      if (state.imageBitmap !== prev.imageBitmap) {
        didFit = false;
        resize();
      } else if (state.transform !== prev.transform) {
        schedule();
      }
    });

    const onWheel = (event: WheelEvent) => {
      const state = useWorkspace.getState();
      if (!state.imageBitmap) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const factor = Math.pow(ZOOM_STEP, -event.deltaY);
      state.setTransform(applyZoom(state.transform, factor, px, py));
    };
    container.addEventListener("wheel", onWheel, { passive: false });

    const pointers = new Map<number, { x: number; y: number }>();
    let panStart: { x: number; y: number; tx: number; ty: number } | null = null;
    let pinchStart:
      | { dist: number; scale: number; tx: number; ty: number; cx: number; cy: number }
      | null = null;

    const onPointerDown = (event: PointerEvent) => {
      const state = useWorkspace.getState();
      if (!state.imageBitmap) return;
      container.setPointerCapture(event.pointerId);
      const rect = container.getBoundingClientRect();
      pointers.set(event.pointerId, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      if (pointers.size === 1) {
        const p = pointers.get(event.pointerId)!;
        panStart = { x: p.x, y: p.y, tx: state.transform.tx, ty: state.transform.ty };
        pinchStart = null;
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        pinchStart = {
          dist,
          scale: state.transform.scale,
          tx: state.transform.tx,
          ty: state.transform.ty,
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
        };
        panStart = null;
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      pointers.set(event.pointerId, { x, y });

      const state = useWorkspace.getState();
      if (pointers.size === 2 && pinchStart) {
        const [a, b] = Array.from(pointers.values());
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart.dist === 0) return;
        const factor = dist / pinchStart.dist;
        const base: Transform = {
          scale: pinchStart.scale,
          tx: pinchStart.tx,
          ty: pinchStart.ty,
        };
        state.setTransform(applyZoom(base, factor, pinchStart.cx, pinchStart.cy));
      } else if (pointers.size === 1 && panStart) {
        state.setTransform({
          scale: state.transform.scale,
          tx: panStart.tx + (x - panStart.x),
          ty: panStart.ty + (y - panStart.y),
        });
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (container.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId);
      }
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) panStart = null;
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);

    return () => {
      observer.disconnect();
      unsubscribe();
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-neutral-100 touch-none select-none"
      role="img"
      aria-label="Notebook image workspace"
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}

function applyZoom(t: Transform, factor: number, px: number, py: number): Transform {
  const next = clamp(t.scale * factor, MIN_SCALE, MAX_SCALE);
  const real = next / t.scale;
  return {
    scale: next,
    tx: px - (px - t.tx) * real,
    ty: py - (py - t.ty) * real,
  };
}

function fitTransform(bitmap: ImageBitmap, width: number, height: number): Transform {
  const pad = 32;
  const sx = (width - pad * 2) / bitmap.width;
  const sy = (height - pad * 2) / bitmap.height;
  const scale = clamp(Math.min(sx, sy), MIN_SCALE, MAX_SCALE);
  const tx = (width - bitmap.width * scale) / 2;
  const ty = (height - bitmap.height * scale) / 2;
  return { scale, tx, ty };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
