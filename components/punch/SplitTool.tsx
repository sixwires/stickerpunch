"use client";

import { useEffect, useRef } from "react";

import { useWorkspace } from "@/lib/workspace/store";
import { watershedSplit } from "@/lib/segmentation/watershedSplit";
import type { Subject } from "@/lib/segmentation/types";

const STROKE_RADIUS_PX = 4;

interface SplitToolProps {
  active: boolean;
  onDone: () => void;
}

export function SplitTool({ active, onDone }: SplitToolProps) {
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const strokeRef = useRef<{ x: number; y: number }[]>([]);

  useEffect(() => {
    if (!active) return;
    const canvas = overlayRef.current;
    if (!canvas) return;
    const canvasEl: HTMLCanvasElement = canvas;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;
    let drawing = false;

    const resize = () => {
      const parent = canvasEl.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      canvasEl.width = Math.max(1, Math.round(rect.width * dpr));
      canvasEl.height = Math.max(1, Math.round(rect.height * dpr));
      canvasEl.style.width = `${rect.width}px`;
      canvasEl.style.height = `${rect.height}px`;
    };

    resize();
    const observer = new ResizeObserver(resize);
    if (canvasEl.parentElement) observer.observe(canvasEl.parentElement);

    const drawStroke = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvasEl.width / dpr, canvasEl.height / dpr);
      const pts = strokeRef.current;
      if (pts.length < 2) return;
      ctx.strokeStyle = "rgba(244, 114, 182, 0.95)"; // pink-400
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    };

    const onPointerDown = (event: PointerEvent) => {
      drawing = true;
      strokeRef.current = [];
      addPoint(event);
      canvasEl.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drawing) return;
      addPoint(event);
      drawStroke();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!drawing) return;
      drawing = false;
      addPoint(event);
      if (canvasEl.hasPointerCapture(event.pointerId)) {
        canvasEl.releasePointerCapture(event.pointerId);
      }
      commitSplit(strokeRef.current);
      strokeRef.current = [];
      drawStroke();
      onDone();
    };

    function addPoint(event: PointerEvent) {
      const rect = canvasEl.getBoundingClientRect();
      strokeRef.current.push({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    }

    canvasEl.addEventListener("pointerdown", onPointerDown);
    canvasEl.addEventListener("pointermove", onPointerMove);
    canvasEl.addEventListener("pointerup", onPointerUp);
    canvasEl.addEventListener("pointercancel", onPointerUp);

    return () => {
      observer.disconnect();
      canvasEl.removeEventListener("pointerdown", onPointerDown);
      canvasEl.removeEventListener("pointermove", onPointerMove);
      canvasEl.removeEventListener("pointerup", onPointerUp);
      canvasEl.removeEventListener("pointercancel", onPointerUp);
    };
  }, [active, onDone]);

  if (!active) return null;
  return (
    <canvas
      ref={overlayRef}
      className="absolute inset-0 cursor-crosshair touch-none"
      aria-label="Draw a stroke to split a subject"
    />
  );
}

function commitSplit(strokeCanvasPoints: { x: number; y: number }[]) {
  if (strokeCanvasPoints.length < 2) return;
  const state = useWorkspace.getState();
  const seg = state.segmentation;
  if (!seg) return;

  const workingPoints = strokeCanvasPoints.map((p) => {
    const sx = (p.x - state.transform.tx) / state.transform.scale;
    const sy = (p.y - state.transform.ty) / state.transform.scale;
    return { x: sx * seg.scale, y: sy * seg.scale };
  });

  const softAlpha = new Uint8Array(seg.softAlpha);
  rasterizeStroke(softAlpha, seg.width, seg.height, workingPoints, STROKE_RADIUS_PX);

  const totalArea = seg.width * seg.height;
  const minArea = Math.max(64, Math.round(totalArea * 0.005));
  const minSeedDistance = Math.max(8, Math.round(Math.sqrt(minArea) * 0.8));
  const ws = watershedSplit(softAlpha, seg.width, seg.height, { minArea, minSeedDistance });

  const subjects: Subject[] = ws.regions.map((region, i) => {
    const mask = new Uint8Array(seg.width * seg.height);
    for (const idx of region.pixels) mask[idx] = softAlpha[idx];
    return {
      id: `s${i + 1}`,
      mask,
      maskWidth: seg.width,
      maskHeight: seg.height,
      bbox: {
        x: region.bbox.minX,
        y: region.bbox.minY,
        w: region.bbox.maxX - region.bbox.minX + 1,
        h: region.bbox.maxY - region.bbox.minY + 1,
      },
      cx: region.cx,
      cy: region.cy,
      area: region.area,
      score: meanAlpha(softAlpha, region.pixels),
    };
  });

  state.setSegmentation({
    width: seg.width,
    height: seg.height,
    scale: seg.scale,
    softAlpha,
    subjects,
    backend: seg.backend,
  });
}

function rasterizeStroke(
  softAlpha: Uint8Array,
  width: number,
  height: number,
  points: { x: number; y: number }[],
  radius: number,
) {
  for (let i = 0; i < points.length - 1; i++) {
    rasterizeSegment(softAlpha, width, height, points[i], points[i + 1], radius);
  }
}

function rasterizeSegment(
  softAlpha: Uint8Array,
  width: number,
  height: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  radius: number,
) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    stampZero(softAlpha, width, height, px, py, radius);
  }
}

function stampZero(
  softAlpha: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
) {
  const r2 = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) softAlpha[y * width + x] = 0;
    }
  }
}

function meanAlpha(softAlpha: Uint8Array, pixels: Uint32Array): number {
  let sum = 0;
  for (const idx of pixels) sum += softAlpha[idx];
  return sum / (pixels.length * 255);
}
