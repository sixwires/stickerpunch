"use client";

import { useEffect, useRef } from "react";

import { boxBlurInPlace } from "@/lib/mask/JellyMask";
import { resampleStroke, type Point } from "@/lib/mask/smoothing";
import { useWorkspace } from "@/lib/workspace/store";
import { JellyOutline } from "./JellyOutline";

const ADD_TINT = { r: 34, g: 197, b: 94 }; // green-500
const TINT_ALPHA_SCALE = 0.85;

export function JellyEditor() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const jelly = useWorkspace((s) => s.jelly);
  const source = useWorkspace((s) => s.source);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;
    let raf = 0;
    let offscreen: OffscreenCanvas | HTMLCanvasElement | null = null;
    let offscreenCtx: ImageBitmapRenderingContext | CanvasRenderingContext2D | null = null;
    let lastVersion = -1;
    let lastMaskW = 0;
    let lastMaskH = 0;
    let rgba = new Uint8ClampedArray(0);

    const ensureOffscreen = (w: number, h: number) => {
      if (offscreen && lastMaskW === w && lastMaskH === h) return;
      lastMaskW = w;
      lastMaskH = h;
      if (typeof OffscreenCanvas !== "undefined") {
        offscreen = new OffscreenCanvas(w, h);
        offscreenCtx = offscreen.getContext("2d") as unknown as CanvasRenderingContext2D;
      } else {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        offscreen = c;
        offscreenCtx = c.getContext("2d");
      }
      rgba = new Uint8ClampedArray(w * h * 4);
    };

    const draw = () => {
      raf = 0;
      const state = useWorkspace.getState();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const jelly = state.jelly;
      if (!jelly || !state.imageBitmap) return;

      const mask = jelly.mask;
      ensureOffscreen(mask.width, mask.height);

      if (jelly.version !== lastVersion && offscreenCtx) {
        mask.paintTinted(rgba, ADD_TINT);
        // Faded so user can see underlying photo through the tint.
        for (let i = 3; i < rgba.length; i += 4) {
          rgba[i] = Math.round(rgba[i] * TINT_ALPHA_SCALE);
        }
        const imageData = new ImageData(rgba, mask.width, mask.height);
        (offscreenCtx as CanvasRenderingContext2D).putImageData(imageData, 0, 0);
        lastVersion = jelly.version;
      }

      const sourceScale = state.source ? state.source.width / mask.width : 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(state.transform.tx, state.transform.ty);
      ctx.scale(state.transform.scale * sourceScale, state.transform.scale * sourceScale);
      ctx.imageSmoothingQuality = "high";
      if (offscreen) ctx.drawImage(offscreen as CanvasImageSource, 0, 0);
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

    const unsubscribe = useWorkspace.subscribe(() => schedule());

    // ---- Pointer handling ----
    let strokeId: number | null = null;
    let strokePoints: Point[] = [];
    let lassoPoints: Point[] = [];

    const clientToWorking = (event: PointerEvent): Point | null => {
      const state = useWorkspace.getState();
      const jelly = state.jelly;
      if (!jelly || !state.source) return null;
      const rect = container.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      // canvas px → source coords (account for fit transform)
      const sx = (px - state.transform.tx) / state.transform.scale;
      const sy = (py - state.transform.ty) / state.transform.scale;
      // source → working
      const scale = jelly.mask.width / state.source.width;
      return { x: sx * scale, y: sy * scale };
    };

    const stampSegment = (from: Point, to: Point) => {
      const jelly = useWorkspace.getState().jelly;
      if (!jelly) return;
      const mode = jelly.tool === "add" ? "add" : "subtract";
      const strength = jelly.tool === "erase" ? 1 : jelly.strength;
      const samples = resampleStroke([from, to], Math.max(1, jelly.brushSize * 0.25));
      for (const pt of samples) {
        jelly.mask.stamp(pt.x, pt.y, {
          radius: jelly.brushSize,
          softness: jelly.softness,
          strength,
          mode,
        });
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const state = useWorkspace.getState();
      const jelly = state.jelly;
      if (!jelly) return;
      // Palm rejection: only the first pointer of a gesture is honored.
      if (strokeId !== null) return;
      const pt = clientToWorking(event);
      if (!pt) return;
      container.setPointerCapture(event.pointerId);
      strokeId = event.pointerId;

      state.beginJellyStroke();

      if (jelly.tool === "lasso") {
        lassoPoints = [pt];
        return;
      }
      strokePoints = [pt];
      jelly.mask.stamp(pt.x, pt.y, {
        radius: jelly.brushSize,
        softness: jelly.softness,
        strength: jelly.tool === "erase" ? 1 : jelly.strength,
        mode: jelly.tool === "add" ? "add" : "subtract",
      });
      state.bumpJellyVersion();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (strokeId !== event.pointerId) return;
      const state = useWorkspace.getState();
      const jelly = state.jelly;
      if (!jelly) return;
      const pt = clientToWorking(event);
      if (!pt) return;
      if (jelly.tool === "lasso") {
        lassoPoints.push(pt);
        return;
      }
      const last = strokePoints[strokePoints.length - 1];
      strokePoints.push(pt);
      stampSegment(last, pt);
      state.bumpJellyVersion();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (strokeId !== event.pointerId) return;
      strokeId = null;
      if (container.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId);
      }
      const state = useWorkspace.getState();
      const jelly = state.jelly;
      if (!jelly) return;
      if (jelly.tool === "lasso" && lassoPoints.length >= 3) {
        rasterizeLasso(jelly.mask.alpha, jelly.mask.width, jelly.mask.height, lassoPoints);
        boxBlurInPlace(jelly.mask.alpha, jelly.mask.width, jelly.mask.height, 2);
        state.bumpJellyVersion();
      }
      strokePoints = [];
      lassoPoints = [];
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);

    return () => {
      observer.disconnect();
      unsubscribe();
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
      className="absolute inset-0 touch-none cursor-crosshair"
      role="application"
      aria-label="Jelly mask editor"
    >
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
      {jelly && source ? (
        <JellyOutline
          alpha={jelly.mask.alpha}
          maskWidth={jelly.mask.width}
          maskHeight={jelly.mask.height}
          sourceWidth={source.width}
          sourceHeight={source.height}
          version={jelly.version}
        />
      ) : null}
    </div>
  );
}

/**
 * Scanline-fill a closed polygon into a Uint8Array alpha buffer. Sets each
 * interior pixel to 255 (caller may blur for softness). Points are in working
 * coordinates.
 */
function rasterizeLasso(
  alpha: Uint8Array,
  width: number,
  height: number,
  points: readonly Point[],
): void {
  if (points.length < 3) return;
  // Build edge table.
  const edges: { yMin: number; yMax: number; xAtYMin: number; slopeInv: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a.y === b.y) continue;
    const top = a.y < b.y ? a : b;
    const bot = a.y < b.y ? b : a;
    edges.push({
      yMin: Math.ceil(top.y),
      yMax: Math.floor(bot.y),
      xAtYMin: top.x + ((Math.ceil(top.y) - top.y) * (bot.x - top.x)) / (bot.y - top.y),
      slopeInv: (bot.x - top.x) / (bot.y - top.y),
    });
  }

  const yStart = Math.max(0, Math.min(...points.map((p) => Math.ceil(p.y))));
  const yEnd = Math.min(height - 1, Math.max(...points.map((p) => Math.floor(p.y))));

  for (let y = yStart; y <= yEnd; y++) {
    const xs: number[] = [];
    for (const e of edges) {
      if (y >= e.yMin && y <= e.yMax) {
        xs.push(e.xAtYMin + e.slopeInv * (y - e.yMin));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xLeft = Math.max(0, Math.ceil(xs[i]));
      const xRight = Math.min(width - 1, Math.floor(xs[i + 1]));
      const rowOffset = y * width;
      for (let x = xLeft; x <= xRight; x++) {
        alpha[rowOffset + x] = 255;
      }
    }
  }
}
