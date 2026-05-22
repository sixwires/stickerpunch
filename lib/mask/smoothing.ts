/**
 * Catmull-Rom resampling for pointer strokes. Given raw pointer points,
 * returns a dense series of samples ~1 px apart along a smooth curve.
 * Output is suitable for stamping a brush along each sample.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Resample raw stroke points along a centripetal Catmull-Rom spline at the
 * given spacing (default 1 px). Always includes the first input point and
 * approximately the last input point.
 */
export function resampleStroke(points: readonly Point[], spacing = 1): Point[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ ...points[0] }];

  const out: Point[] = [{ ...points[0] }];
  let leftover = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const segment = sampleSegmentWithLeftover(p0, p1, p2, p3, spacing, leftover);
    for (const pt of segment.points) out.push(pt);
    leftover = segment.leftover;
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (tail.x !== last.x || tail.y !== last.y) out.push({ ...last });
  return out;
}

function sampleSegmentWithLeftover(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  spacing: number,
  leftover: number,
): { points: Point[]; leftover: number } {
  // Centripetal Catmull-Rom uses sqrt knot spacing. Convert to local Bezier
  // control points (Hermite-style) for stable sampling.
  const alpha = 0.5;
  const t01 = Math.pow(distance(p0, p1), alpha);
  const t12 = Math.pow(distance(p1, p2), alpha);
  const t23 = Math.pow(distance(p2, p3), alpha);

  const m1x = computeTangent(p0.x, p1.x, p2.x, t01, t12);
  const m1y = computeTangent(p0.y, p1.y, p2.y, t01, t12);
  const m2x = computeTangent(p1.x, p2.x, p3.x, t12, t23);
  const m2y = computeTangent(p1.y, p2.y, p3.y, t12, t23);

  // Convert Hermite (p1, p2, m1, m2) to cubic Bezier control points.
  const cp1x = p1.x + m1x / 3;
  const cp1y = p1.y + m1y / 3;
  const cp2x = p2.x - m2x / 3;
  const cp2y = p2.y - m2y / 3;

  // Estimate arc length to decide sample count.
  const polyLen =
    distance(p1, { x: cp1x, y: cp1y }) +
    distance({ x: cp1x, y: cp1y }, { x: cp2x, y: cp2y }) +
    distance({ x: cp2x, y: cp2y }, p2);
  const chordLen = distance(p1, p2);
  const arcLen = (polyLen + chordLen) / 2;
  const samples = Math.max(2, Math.ceil(arcLen / Math.max(0.25, spacing)) + 2);

  // Walk t with cumulative arc length to hit `spacing` accurately.
  const out: Point[] = [];
  let prev: Point = { x: p1.x, y: p1.y };
  let acc = leftover;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const pt = evalBezier(p1.x, p1.y, cp1x, cp1y, cp2x, cp2y, p2.x, p2.y, t);
    const d = distance(prev, pt);
    acc += d;
    if (acc >= spacing) {
      // emit one or more points along the chord prev→pt
      while (acc >= spacing) {
        const back = acc - spacing;
        const ratio = (d - back) / d;
        if (Number.isFinite(ratio)) {
          out.push({
            x: prev.x + (pt.x - prev.x) * ratio,
            y: prev.y + (pt.y - prev.y) * ratio,
          });
        } else {
          out.push({ x: pt.x, y: pt.y });
        }
        acc -= spacing;
      }
    }
    prev = pt;
  }
  return { points: out, leftover: acc };
}

function computeTangent(a: number, b: number, c: number, dAB: number, dBC: number): number {
  // Centripetal Catmull-Rom tangent at b.
  if (dAB === 0 && dBC === 0) return 0;
  const t = (c - b) / Math.max(dBC, 1e-6) - (a - b) / Math.max(dAB, 1e-6) + (c - a) / Math.max(dAB + dBC, 1e-6);
  return t * (dAB + dBC) * 0.5;
}

function evalBezier(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t: number,
): Point {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const w0 = uu * u;
  const w1 = 3 * uu * t;
  const w2 = 3 * u * tt;
  const w3 = tt * t;
  return {
    x: w0 * x0 + w1 * x1 + w2 * x2 + w3 * x3,
    y: w0 * y0 + w1 * y1 + w2 * y2 + w3 * y3,
  };
}

function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}
