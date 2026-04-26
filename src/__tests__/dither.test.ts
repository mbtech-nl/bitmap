import { describe, expect, it } from 'vitest';

import { atkinson, bayer4, bayer8, floydSteinberg, jarvisJudiceNinke, stucki } from '../dither.js';
// eslint-disable-next-line @typescript-eslint/no-import-type-side-effects
import { type LabelBitmap } from '../types.js';

type Ditherer = (
  lum: Float32Array,
  w: number,
  h: number,
  invert: boolean,
  mask?: Uint8Array,
) => LabelBitmap;

function countBlackPixels(data: Uint8Array, width: number, height: number): number {
  const rowBytes = Math.ceil(width / 8);
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * rowBytes + Math.floor(x / 8);
      if (((data[idx]! >> (7 - (x % 8))) & 1) === 1) {
        total += 1;
      }
    }
  }
  return total;
}

describe('floydSteinberg', () => {
  it('all-white input produces all-zero output', () => {
    const bmp = floydSteinberg(new Float32Array(16).fill(1), 4, 4, false);
    expect(Array.from(bmp.data)).toEqual([0, 0, 0, 0]);
  });

  it('all-black input produces all-set output', () => {
    const bmp = floydSteinberg(new Float32Array(16).fill(0), 4, 4, false);
    expect(Array.from(bmp.data)).toEqual([0xf0, 0xf0, 0xf0, 0xf0]);
  });

  it('mid-grey (0.5) produces roughly 50% black pixels', () => {
    const width = 32;
    const height = 32;
    const bmp = floydSteinberg(new Float32Array(width * height).fill(0.5), width, height, false);
    const blackRatio = countBlackPixels(bmp.data, width, height) / (width * height);
    expect(blackRatio).toBeGreaterThan(0.35);
    expect(blackRatio).toBeLessThan(0.65);
  });

  it('error does not propagate outside bitmap bounds', () => {
    const bmp = floydSteinberg(new Float32Array([0.2]), 1, 1, false);
    expect(bmp.data.length).toBe(1);
  });

  it('invert flag swaps black and white', () => {
    const values = new Float32Array([0, 1, 0, 1]);
    const normal = floydSteinberg(values, 2, 2, false);
    const inverted = floydSteinberg(values, 2, 2, true);
    expect(normal.data[0]).not.toBe(inverted.data[0]);
  });

  it('data length matches heightPx * ceil(widthPx / 8)', () => {
    const bmp = floydSteinberg(new Float32Array(30), 10, 3, false);
    expect(bmp.data.length).toBe(6);
  });

  it('trailing bits in each row are zero', () => {
    const bmp = floydSteinberg(new Float32Array(15).fill(0), 5, 3, false);
    const rowBytes = 1;
    for (let y = 0; y < 3; y += 1) {
      const last = bmp.data[y * rowBytes]!;
      expect(last & 0b00000111).toBe(0);
    }
  });

  it('1x1 pixel: below 0.5 becomes black', () => {
    const bmp = floydSteinberg(new Float32Array([0.2]), 1, 1, false);
    expect(bmp.data[0]).toBe(0b10000000);
  });

  it('1x1 pixel: above 0.5 becomes white', () => {
    const bmp = floydSteinberg(new Float32Array([0.8]), 1, 1, false);
    expect(bmp.data[0]).toBe(0);
  });

  it('single-row image has stable output', () => {
    const bmp = floydSteinberg(new Float32Array([0.2, 0.8, 0.2, 0.8]), 4, 1, false);
    expect(bmp.data.length).toBe(1);
  });

  it('snapshot: 16x8 gradient matches known dithered output', () => {
    const width = 16;
    const height = 8;
    const luminance = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        luminance[y * width + x] = x / (width - 1);
      }
    }
    expect(Array.from(floydSteinberg(luminance, width, height, false).data)).toMatchSnapshot();
  });
});

const ERROR_DIFFUSION_METHODS: readonly (readonly [string, Ditherer])[] = [
  ['atkinson', atkinson],
  ['stucki', stucki],
  ['jarvis-judice-ninke', jarvisJudiceNinke],
];

describe.each(ERROR_DIFFUSION_METHODS)('%s', (_name, dither) => {
  it('all-white input produces all-zero output', () => {
    const bmp = dither(new Float32Array(16).fill(1), 4, 4, false);
    expect(Array.from(bmp.data)).toEqual([0, 0, 0, 0]);
  });

  it('all-black input produces all-set output', () => {
    const bmp = dither(new Float32Array(16).fill(0), 4, 4, false);
    expect(Array.from(bmp.data)).toEqual([0xf0, 0xf0, 0xf0, 0xf0]);
  });

  it('mid-grey (0.5) produces 35–65% black pixels on a 32x32 field', () => {
    const width = 32;
    const height = 32;
    const bmp = dither(new Float32Array(width * height).fill(0.5), width, height, false);
    const blackRatio = countBlackPixels(bmp.data, width, height) / (width * height);
    expect(blackRatio).toBeGreaterThan(0.35);
    expect(blackRatio).toBeLessThan(0.65);
  });

  it('does not write out of bounds on 1x1 input', () => {
    const bmp = dither(new Float32Array([0.2]), 1, 1, false);
    expect(bmp.data.length).toBe(1);
  });

  it('invert flag swaps black and white', () => {
    const values = new Float32Array([0, 1, 0, 1]);
    const normal = dither(values, 2, 2, false);
    const inverted = dither(values, 2, 2, true);
    expect(normal.data[0]).not.toBe(inverted.data[0]);
  });

  it('data length matches heightPx * ceil(widthPx / 8)', () => {
    const bmp = dither(new Float32Array(30), 10, 3, false);
    expect(bmp.data.length).toBe(6);
  });

  it('trailing bits in each row are zero', () => {
    const bmp = dither(new Float32Array(15).fill(0), 5, 3, false);
    for (let y = 0; y < 3; y += 1) {
      expect(bmp.data[y]! & 0b00000111).toBe(0);
    }
  });

  it('snapshot: 16x8 horizontal gradient matches known output', () => {
    const width = 16;
    const height = 8;
    const luminance = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        luminance[y * width + x] = x / (width - 1);
      }
    }
    expect(Array.from(dither(luminance, width, height, false).data)).toMatchSnapshot();
  });

  it('leaves the input luminance Float32Array unchanged', () => {
    const luminance = new Float32Array([0.1, 0.4, 0.6, 0.9]);
    const before = Array.from(luminance);
    dither(luminance, 2, 2, false);
    expect(Array.from(luminance)).toEqual(before);
  });

  it('single-row image has stable output', () => {
    const bmp = dither(new Float32Array([0.2, 0.8, 0.2, 0.8]), 4, 1, false);
    expect(bmp.data.length).toBe(1);
  });
});

describe('floydSteinberg leaves the input luminance Float32Array unchanged', () => {
  it('does not mutate the input array', () => {
    const luminance = new Float32Array([0.1, 0.4, 0.6, 0.9]);
    const before = Array.from(luminance);
    floydSteinberg(luminance, 2, 2, false);
    expect(Array.from(luminance)).toEqual(before);
  });
});

const BAYER_METHODS: readonly (readonly [string, Ditherer])[] = [
  ['bayer4', bayer4],
  ['bayer8', bayer8],
];

describe.each(BAYER_METHODS)('%s', (_name, dither) => {
  it('all-white input produces all-zero output', () => {
    const bmp = dither(new Float32Array(16).fill(1), 4, 4, false);
    expect(Array.from(bmp.data)).toEqual([0, 0, 0, 0]);
  });

  it('all-black input produces all-set output', () => {
    const bmp = dither(new Float32Array(16).fill(0), 4, 4, false);
    expect(Array.from(bmp.data)).toEqual([0xf0, 0xf0, 0xf0, 0xf0]);
  });

  it('mid-grey (0.5) produces 35–65% black pixels on a 32x32 field', () => {
    const width = 32;
    const height = 32;
    const bmp = dither(new Float32Array(width * height).fill(0.5), width, height, false);
    const blackRatio = countBlackPixels(bmp.data, width, height) / (width * height);
    expect(blackRatio).toBeGreaterThan(0.35);
    expect(blackRatio).toBeLessThan(0.65);
  });

  it('does not write out of bounds on 1x1 input', () => {
    const bmp = dither(new Float32Array([0.2]), 1, 1, false);
    expect(bmp.data.length).toBe(1);
  });

  it('invert flag swaps black and white', () => {
    const values = new Float32Array([0, 1, 0, 1]);
    const normal = dither(values, 2, 2, false);
    const inverted = dither(values, 2, 2, true);
    expect(normal.data[0]).not.toBe(inverted.data[0]);
  });

  it('data length matches heightPx * ceil(widthPx / 8)', () => {
    const bmp = dither(new Float32Array(30), 10, 3, false);
    expect(bmp.data.length).toBe(6);
  });

  it('trailing bits in each row are zero', () => {
    const bmp = dither(new Float32Array(15).fill(0), 5, 3, false);
    for (let y = 0; y < 3; y += 1) {
      expect(bmp.data[y]! & 0b00000111).toBe(0);
    }
  });

  it('snapshot: 16x8 horizontal gradient matches known output', () => {
    const width = 16;
    const height = 8;
    const luminance = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        luminance[y * width + x] = x / (width - 1);
      }
    }
    expect(Array.from(dither(luminance, width, height, false).data)).toMatchSnapshot();
  });

  it('leaves the input luminance Float32Array unchanged', () => {
    const luminance = new Float32Array([0.1, 0.4, 0.6, 0.9]);
    const before = Array.from(luminance);
    dither(luminance, 2, 2, false);
    expect(Array.from(luminance)).toEqual(before);
  });

  it('is deterministic — same input yields same output across calls', () => {
    const lum = new Float32Array(64).fill(0.5);
    const a = dither(lum, 8, 8, false);
    const b = dither(lum, 8, 8, false);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('tiles correctly for widths/heights not divisible by matrix size', () => {
    // 5x5 (not divisible by 4 or 8) at uniform 0.5 — must produce a stable,
    // tiled output (not all the same byte).
    const lum = new Float32Array(25).fill(0.5);
    const bmp = dither(lum, 5, 5, false);
    expect(bmp.data.length).toBe(5);
    // Stable tiling: re-running gives the exact same bytes.
    const again = dither(lum, 5, 5, false);
    expect(Array.from(bmp.data)).toEqual(Array.from(again.data));
  });
});

const ALL_ERROR_DIFFUSION: readonly (readonly [string, Ditherer])[] = [
  ['floyd-steinberg', floydSteinberg],
  ['atkinson', atkinson],
  ['stucki', stucki],
  ['jarvis-judice-ninke', jarvisJudiceNinke],
];

describe.each(ALL_ERROR_DIFFUSION)('%s with mask', (_name, dither) => {
  it('omitting mask is identical to passing all-ones mask', () => {
    const w = 16;
    const h = 8;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < lum.length; i += 1) lum[i] = (i % 7) / 7;
    const noMask = dither(lum, w, h, false);
    const onesMask = dither(lum, w, h, false, new Uint8Array(w * h).fill(1));
    expect(Array.from(onesMask.data)).toEqual(Array.from(noMask.data));
  });

  it('all-zero mask: no error diffuses, only direct quantisation drives output', () => {
    // With every neighbour masked out, there is no error propagation. The
    // output is a per-pixel hard threshold at 0.5 of the *original* values.
    const w = 4;
    const h = 4;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < lum.length; i += 1) lum[i] = i % 2 === 0 ? 0.2 : 0.8;
    const bmp = dither(lum, w, h, false, new Uint8Array(w * h));
    // Even-index pixels (lum 0.2) are below 0.5 → black bit set.
    // Odd-index pixels (lum 0.8) are above → no bit set.
    // Pattern per row: 1010 1010 → 0xA0 (in MSB-first, 4 pixels in top nibble).
    expect(bmp.data).toEqual(new Uint8Array([0xa0, 0xa0, 0xa0, 0xa0]));
  });

  it('error does not leak into masked-out neighbours', () => {
    // Single foreground pixel at (1, 1) with mid-grey luminance. All other
    // pixels start at luminance 1.0 (would never set a bit on their own) and
    // are mask-excluded, so they MUST remain bitless after dither.
    const w = 4;
    const h = 4;
    const lum = new Float32Array(w * h).fill(1);
    lum[1 * w + 1] = 0.4; // below 0.5 → black, error -0.4 would normally leak
    const mask = new Uint8Array(w * h);
    mask[1 * w + 1] = 1;
    const bmp = dither(lum, w, h, false, mask);
    // Only bit at (1, 1) — byte index 0, bit (7 - 1) = 6 → 0b01000000 = 0x40.
    expect(bmp.data).toEqual(new Uint8Array([0, 0x40, 0, 0]));
  });
});

describe.each(BAYER_METHODS)('%s with mask (signature uniformity)', (_name, dither) => {
  it('accepts a mask argument and ignores it (background luminance 1.0 is safe)', () => {
    const w = 4;
    const h = 4;
    const lum = new Float32Array(w * h).fill(1); // all-white
    const mask = new Uint8Array(w * h); // all-zero mask
    const bmp = dither(lum, w, h, false, mask);
    expect(Array.from(bmp.data)).toEqual([0, 0, 0, 0]);
  });

  it('output is identical with mask argument vs without', () => {
    const w = 8;
    const h = 8;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < lum.length; i += 1) lum[i] = (i % 5) / 5;
    const a = dither(lum, w, h, false);
    const b = dither(lum, w, h, false, new Uint8Array(w * h).fill(1));
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});
