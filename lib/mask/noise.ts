/**
 * 3D simplex noise, seeded. Adapted from Stefan Gustavson's reference
 * implementation. Output range is approximately [-1, 1].
 *
 * Used to displace jelly-outline vertices over time (x, y, t).
 */

const GRAD3 = new Int8Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

export interface SimplexNoise {
  noise3(x: number, y: number, z: number): number;
}

/** Build a seeded simplex noise sampler. Seed 0 uses a fixed default. */
export function createSimplex(seed = 1): SimplexNoise {
  const perm = buildPerm(seed);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) permMod12[i] = perm[i] % 12;

  const F3 = 1 / 3;
  const G3 = 1 / 6;

  function noise3(x: number, y: number, z: number): number {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;
    const x0 = x - X0;
    const y0 = y - Y0;
    const z0 = z - Z0;

    let i1: number, j1: number, k1: number;
    let i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0;
        i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0;
        i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1;
        i2 = 1; j2 = 0; k2 = 1;
      }
    } else {
      if (y0 < z0) {
        i1 = 0; j1 = 0; k1 = 1;
        i2 = 0; j2 = 1; k2 = 1;
      } else if (x0 < z0) {
        i1 = 0; j1 = 1; k1 = 0;
        i2 = 0; j2 = 1; k2 = 1;
      } else {
        i1 = 0; j1 = 1; k1 = 0;
        i2 = 1; j2 = 1; k2 = 0;
      }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    const gi0 = permMod12[ii + perm[jj + perm[kk]]];
    const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]];
    const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]];
    const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]];

    return 32 * (corner(gi0, x0, y0, z0) +
      corner(gi1, x1, y1, z1) +
      corner(gi2, x2, y2, z2) +
      corner(gi3, x3, y3, z3));
  }

  function corner(gi: number, x: number, y: number, z: number): number {
    let t = 0.6 - x * x - y * y - z * z;
    if (t < 0) return 0;
    const base = gi * 3;
    const gx = GRAD3[base];
    const gy = GRAD3[base + 1];
    const gz = GRAD3[base + 2];
    t *= t;
    return t * t * (gx * x + gy * y + gz * z);
  }

  return { noise3 };
}

/** Build a deterministic 0..255 permutation for the given seed. */
function buildPerm(seed: number): Uint8Array {
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  // Fisher–Yates shuffle using xorshift seeded RNG.
  const rng = xorshift32(seed === 0 ? 0x9e3779b9 : seed);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }
  const out = new Uint8Array(512);
  for (let i = 0; i < 512; i++) out[i] = base[i & 255];
  return out;
}

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x12345678;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0xffffffff);
  };
}
