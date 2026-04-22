import { describe, expect, it } from 'vitest';

import { floydSteinberg } from '../dither.js';

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
