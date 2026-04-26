// eslint-disable-next-line @typescript-eslint/no-import-type-side-effects
import { type LabelBitmap } from './types.js';

interface ErrorDiffusionKernel {
  readonly name: string;
  /** Tuples of [dx, dy, weight]. Weights must sum to ≤ 1. */
  readonly offsets: readonly (readonly [number, number, number])[];
}

const FLOYD_STEINBERG: ErrorDiffusionKernel = {
  name: 'floyd-steinberg',
  // Order is load-bearing for byte-equivalence with v1.0 output: right, BL, B, BR.
  // Floating-point error accumulation differs if you reorder these — do not
  // "tidy" this list. The v1.0 regression snapshot in image.test.ts is the
  // back-stop, but a drift here is much easier to diagnose if the order
  // matches the imperative code that shipped in v1.0.
  offsets: [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ],
};

const ATKINSON: ErrorDiffusionKernel = {
  name: 'atkinson',
  // Atkinson diffuses only 6/8 of the error — the remaining 2/8 is dropped.
  offsets: [
    [1, 0, 1 / 8],
    [2, 0, 1 / 8],
    [-1, 1, 1 / 8],
    [0, 1, 1 / 8],
    [1, 1, 1 / 8],
    [0, 2, 1 / 8],
  ],
};

const STUCKI: ErrorDiffusionKernel = {
  name: 'stucki',
  offsets: [
    [1, 0, 8 / 42],
    [2, 0, 4 / 42],
    [-2, 1, 2 / 42],
    [-1, 1, 4 / 42],
    [0, 1, 8 / 42],
    [1, 1, 4 / 42],
    [2, 1, 2 / 42],
    [-2, 2, 1 / 42],
    [-1, 2, 2 / 42],
    [0, 2, 4 / 42],
    [1, 2, 2 / 42],
    [2, 2, 1 / 42],
  ],
};

const JJN: ErrorDiffusionKernel = {
  name: 'jarvis-judice-ninke',
  offsets: [
    [1, 0, 7 / 48],
    [2, 0, 5 / 48],
    [-2, 1, 3 / 48],
    [-1, 1, 5 / 48],
    [0, 1, 7 / 48],
    [1, 1, 5 / 48],
    [2, 1, 3 / 48],
    [-2, 2, 1 / 48],
    [-1, 2, 3 / 48],
    [0, 2, 5 / 48],
    [1, 2, 3 / 48],
    [2, 2, 1 / 48],
  ],
};

function errorDiffusion(
  luminance: Float32Array,
  width: number,
  height: number,
  invert: boolean,
  kernel: ErrorDiffusionKernel,
  mask?: Uint8Array,
): LabelBitmap {
  const pixels = new Float32Array(luminance);
  const rowBytes = Math.ceil(width / 8);
  const data = new Uint8Array(height * rowBytes);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const oldPixel = pixels[idx]!;
      const newPixel = oldPixel < 0.5 ? 0 : 1;
      pixels[idx] = newPixel;
      const error = oldPixel - newPixel;

      for (const [dx, dy, w] of kernel.offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny >= height) continue;
        // mask enforces renderMultiPlaneImage's mutual-exclusivity contract:
        // error never lands on a pixel classified to a different plane. In
        // typical inputs error diffusion's self-balancing means outputs are
        // identical with or without this check (PLAN-multiplane.md §10
        // 2026-04-27 blocker), but it remains the only hard guarantee for
        // adversarial luminance buffers — do not remove without revisiting
        // the contract.
        if (mask?.[ny * width + nx] === 0) continue;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        pixels[ny * width + nx]! += error * w;
      }

      const isBlack = invert ? newPixel === 1 : newPixel === 0;
      if (isBlack) {
        const byteIndex = y * rowBytes + Math.floor(x / 8);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        data[byteIndex]! |= 1 << (7 - (x % 8));
      }
    }
  }

  return { widthPx: width, heightPx: height, data };
}

export function floydSteinberg(
  luminance: Float32Array,
  width: number,
  height: number,
  invert: boolean,
  mask?: Uint8Array,
): LabelBitmap {
  return errorDiffusion(luminance, width, height, invert, FLOYD_STEINBERG, mask);
}

export function atkinson(
  luminance: Float32Array,
  width: number,
  height: number,
  invert: boolean,
  mask?: Uint8Array,
): LabelBitmap {
  return errorDiffusion(luminance, width, height, invert, ATKINSON, mask);
}

export function stucki(
  luminance: Float32Array,
  width: number,
  height: number,
  invert: boolean,
  mask?: Uint8Array,
): LabelBitmap {
  return errorDiffusion(luminance, width, height, invert, STUCKI, mask);
}

export function jarvisJudiceNinke(
  luminance: Float32Array,
  width: number,
  height: number,
  invert: boolean,
  mask?: Uint8Array,
): LabelBitmap {
  return errorDiffusion(luminance, width, height, invert, JJN, mask);
}

// Bayer matrices use the (v + 0.5) / N² normalisation so the threshold for
// a 50%-grey input falls cleanly between matrix steps (no off-by-one against
// pure 0.5 inputs).
const BAYER_4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  v => (v + 0.5) / 16,
);

const BAYER_8: readonly number[] = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map(v => (v + 0.5) / 64);

function ordered(
  luminance: Float32Array,
  width: number,
  height: number,
  invert: boolean,
  matrix: readonly number[],
  matrixSize: 4 | 8,
  // mask is accepted for signature uniformity with error-diffusion ditherers
  // but ignored here. Background pixels in renderMultiPlaneImage are set to
  // luminance 1.0; the maximum Bayer threshold is < 1, so background bits
  // are never set regardless of mask. See PLAN-multiplane.md §4.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _mask?: Uint8Array,
): LabelBitmap {
  const rowBytes = Math.ceil(width / 8);
  const data = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const t = matrix[(y % matrixSize) * matrixSize + (x % matrixSize)]!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const dark = luminance[y * width + x]! < t;
      const isBlack = invert ? !dark : dark;
      if (isBlack) {
        const byteIdx = y * rowBytes + Math.floor(x / 8);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        data[byteIdx]! |= 1 << (7 - (x % 8));
      }
    }
  }
  return { widthPx: width, heightPx: height, data };
}

export function bayer4(
  luminance: Float32Array,
  width: number,
  height: number,
  invert: boolean,
  mask?: Uint8Array,
): LabelBitmap {
  return ordered(luminance, width, height, invert, BAYER_4, 4, mask);
}

export function bayer8(
  luminance: Float32Array,
  width: number,
  height: number,
  invert: boolean,
  mask?: Uint8Array,
): LabelBitmap {
  return ordered(luminance, width, height, invert, BAYER_8, 8, mask);
}
