/**
 * 4-connected component labeling on a binary mask (Uint8: nonzero = foreground).
 * Returns a Int32Array of labels (0 = background, 1..N = component IDs) and
 * per-label stats. Iterative flood fill via explicit stack — no recursion.
 */

export interface Component {
  label: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
}

export interface LabelResult {
  labels: Int32Array;
  components: Component[];
  width: number;
  height: number;
}

export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): LabelResult {
  const labels = new Int32Array(width * height);
  const components: Component[] = [];
  const stack: number[] = [];

  let next = 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 0 || labels[idx] !== 0) continue;

      const label = next++;
      stack.length = 0;
      stack.push(idx);

      let area = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (labels[cur] !== 0) continue;
        if (mask[cur] === 0) continue;
        labels[cur] = label;

        const cy = (cur / width) | 0;
        const cx = cur - cy * width;
        area++;
        sumX += cx;
        sumY += cy;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;

        if (cx > 0) stack.push(cur - 1);
        if (cx + 1 < width) stack.push(cur + 1);
        if (cy > 0) stack.push(cur - width);
        if (cy + 1 < height) stack.push(cur + width);
      }

      components.push({
        label,
        area,
        minX,
        minY,
        maxX,
        maxY,
        cx: sumX / area,
        cy: sumY / area,
      });
    }
  }

  return { labels, components, width, height };
}
