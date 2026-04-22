import { describe, expect, it } from 'vitest';

import { renderImage } from '../image.js';

function rgba(
  width: number,
  height: number,
  pixels: number[],
): { width: number; height: number; data: Uint8Array } {
  return { width, height, data: new Uint8Array(pixels) };
}

describe('renderImage', () => {
  it('throws on zero-width image', () => {
    expect(() => renderImage(rgba(0, 1, []))).toThrow(RangeError);
  });

  it('throws on zero-height image', () => {
    expect(() => renderImage(rgba(1, 0, []))).toThrow(RangeError);
  });

  it('throws if data length does not match dimensions', () => {
    expect(() => renderImage(rgba(1, 1, [0, 0, 0]))).toThrow(RangeError);
  });

  it('all-white RGBA gives all-zero bitmap data', () => {
    const bmp = renderImage(rgba(2, 1, [255, 255, 255, 255, 255, 255, 255, 255]));
    expect(Array.from(bmp.data)).toEqual([0]);
  });

  it('all-black RGBA gives all-set bitmap data', () => {
    const bmp = renderImage(rgba(2, 1, [0, 0, 0, 255, 0, 0, 0, 255]));
    expect(Array.from(bmp.data)).toEqual([0b11000000]);
  });

  it('threshold=0 results in all white', () => {
    const bmp = renderImage(rgba(2, 1, [0, 0, 0, 255, 0, 0, 0, 255]), { threshold: 0 });
    expect(Array.from(bmp.data)).toEqual([0]);
  });

  it('invert flips output bits', () => {
    const img = rgba(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]);
    const normal = renderImage(img);
    const inverted = renderImage(img, { invert: true });
    expect(normal.data[0]).not.toBe(inverted.data[0]);
  });

  it('alpha compositing uses white background', () => {
    const bmp = renderImage(rgba(1, 1, [0, 0, 0, 0]));
    expect(bmp.data[0]).toBe(0);
  });

  it('rotate=90 swaps dimensions', () => {
    const bmp = renderImage(rgba(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]), { rotate: 90 });
    expect(bmp.widthPx).toBe(1);
    expect(bmp.heightPx).toBe(2);
  });

  it('rotate=180 preserves dimensions', () => {
    const bmp = renderImage(rgba(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]), { rotate: 180 });
    expect(bmp.widthPx).toBe(2);
    expect(bmp.heightPx).toBe(1);
  });

  it('rotate=270 swaps dimensions', () => {
    const bmp = renderImage(rgba(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]), { rotate: 270 });
    expect(bmp.widthPx).toBe(1);
    expect(bmp.heightPx).toBe(2);
  });

  it('dither=true produces non-uniform output for mid-grey input', () => {
    const pixels = new Array(64).fill(0).flatMap(() => [128, 128, 128, 255]);
    const bmp = renderImage(rgba(8, 8, pixels), { dither: true });
    const unique = new Set(Array.from(bmp.data));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('dither=false produces uniform output for mid-grey input', () => {
    const pixels = new Array(64).fill(0).flatMap(() => [128, 128, 128, 255]);
    const bmp = renderImage(rgba(8, 8, pixels), { dither: false, threshold: 128 });
    expect(new Set(Array.from(bmp.data)).size).toBe(1);
  });
});
