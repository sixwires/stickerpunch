"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { extractRings, type Ring } from "@/lib/mask/marching";
import { createSimplex } from "@/lib/mask/noise";
import { useWorkspace } from "@/lib/workspace/store";

const SIMPLEX = createSimplex(0xc0ffee);
const NOISE_SPATIAL = 0.012;
const NOISE_TIME = 0.6;

const DESKTOP_AMPLITUDE = 1.5;
const MOBILE_AMPLITUDE = 1;
const DESKTOP_HZ = 30;
const MOBILE_HZ = 12;

export interface JellyOutlineProps {
  /** Working-resolution alpha buffer. */
  alpha: Uint8Array;
  /** Working width/height. */
  maskWidth: number;
  maskHeight: number;
  /** Source image width — used to convert ring coords back to source space. */
  sourceWidth: number;
  /** Source image height. */
  sourceHeight: number;
  /** Re-extract contour rings when this version changes. */
  version: number;
  /** Wobble amplitude multiplier (0 = static, 1 = default). */
  amplitudeScale?: number;
  /** Stroke color (defaults to a green that reads on most photos). */
  stroke?: string;
  /** Stroke width in CSS px regardless of zoom. */
  strokeWidthPx?: number;
  /** Test-only override to disable matchMedia for SSR / fixtures. */
  forceMobile?: boolean;
}

export function JellyOutline({
  alpha,
  maskWidth,
  maskHeight,
  sourceWidth,
  sourceHeight,
  version,
  amplitudeScale = 1,
  stroke = "#22c55e",
  strokeWidthPx = 2,
  forceMobile,
}: JellyOutlineProps) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const ringsRef = useRef<Ring[]>([]);
  const isMobile = useSyncExternalStore(
    subscribeCoarsePointer,
    () => (forceMobile !== undefined ? forceMobile : getCoarsePointer()),
    () => forceMobile ?? false,
  );

  // Re-extract contour rings when the mask alpha or version changes. Coords
  // are in source space.
  const rings = useMemo(() => {
    if (!alpha || maskWidth === 0 || maskHeight === 0) return [] as Ring[];
    const extracted = extractRings(alpha, maskWidth, maskHeight, {
      iso: 128,
      maxEdge: 256,
      maxVerts: 256,
    });
    const sx = sourceWidth / maskWidth;
    const sy = sourceHeight / maskHeight;
    if (sx === 1 && sy === 1) return extracted;
    return extracted.map((ring) => {
      const out = new Float32Array(ring.points.length);
      for (let i = 0; i < ring.points.length; i += 2) {
        out[i] = ring.points[i] * sx;
        out[i + 1] = ring.points[i + 1] * sy;
      }
      return { points: out };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, alpha, maskWidth, maskHeight, sourceWidth, sourceHeight]);

  useEffect(() => {
    ringsRef.current = rings;
  }, [rings]);

  // Animation loop: rebuild SVG path string at the device's Hz.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hz = isMobile ? MOBILE_HZ : DESKTOP_HZ;
    const baseAmp = (isMobile ? MOBILE_AMPLITUDE : DESKTOP_AMPLITUDE) * amplitudeScale;
    const minInterval = 1000 / hz;

    let raf = 0;
    let last = 0;
    const start = performance.now();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < minInterval) return;
      last = now;
      const path = pathRef.current;
      if (!path) return;
      const transform = useWorkspace.getState().transform;
      // Convert source coords to canvas CSS px so stroke-width stays constant.
      const d = buildPath(ringsRef.current, transform, baseAmp, (now - start) / 1000);
      path.setAttribute("d", d);
    };

    raf = requestAnimationFrame(tick);

    const unsubscribe = useWorkspace.subscribe((state, prev) => {
      if (state.transform !== prev.transform) {
        // Force one redraw next frame.
        last = 0;
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [isMobile, amplitudeScale, version]);

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
      width="100%"
      height="100%"
      style={{ overflow: "visible" }}
    >
      <defs>
        <filter id="jelly-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.55" />
          </feComponentTransfer>
        </filter>
      </defs>
      <path
        ref={pathRef}
        d=""
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidthPx}
        strokeLinejoin="round"
        strokeLinecap="round"
        filter="url(#jelly-glow)"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

interface CanvasTransform {
  scale: number;
  tx: number;
  ty: number;
}

function getCoarsePointer(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

function subscribeCoarsePointer(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia("(pointer: coarse)");
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

function buildPath(
  rings: readonly Ring[],
  transform: CanvasTransform,
  amplitude: number,
  time: number,
): string {
  if (rings.length === 0) return "";
  let d = "";
  for (const ring of rings) {
    const pts = ring.points;
    const n = pts.length / 2;
    if (n < 3) continue;
    // Displaced points in canvas px.
    const xs: number[] = new Array(n);
    const ys: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const px = pts[i * 2];
      const py = pts[i * 2 + 1];
      const nx = SIMPLEX.noise3(px * NOISE_SPATIAL, py * NOISE_SPATIAL, time * NOISE_TIME);
      const ny = SIMPLEX.noise3(
        (px + 1000) * NOISE_SPATIAL,
        (py + 1000) * NOISE_SPATIAL,
        time * NOISE_TIME,
      );
      const cx = px + nx * amplitude;
      const cy = py + ny * amplitude;
      xs[i] = cx * transform.scale + transform.tx;
      ys[i] = cy * transform.scale + transform.ty;
    }
    // Quadratic-Bezier-through-midpoints smoothing for the closed ring.
    const midX = (xs[n - 1] + xs[0]) / 2;
    const midY = (ys[n - 1] + ys[0]) / 2;
    d += `M ${midX.toFixed(2)} ${midY.toFixed(2)} `;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const mx = (xs[i] + xs[j]) / 2;
      const my = (ys[i] + ys[j]) / 2;
      d += `Q ${xs[i].toFixed(2)} ${ys[i].toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)} `;
    }
    d += "Z ";
  }
  return d;
}
