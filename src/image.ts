import { floydSteinberg } from './dither.js';
import { rotateBitmap } from './transform.js';
import type { ImageRenderOptions, LabelBitmap, RawImageData } from './types.js';

export function renderImage(image: RawImageData, options: ImageRenderOptions = {}): LabelBitmap {
  if (image.width === 0 || image.height === 0) {
    throw new RangeError('image dimensions must be non-zero');
  }
  if (image.data.length !== image.width * image.height * 4) {
    throw new RangeError('image.data length does not match dimensions');
  }

  const { threshold = 128, dither = false, invert = false, rotate = 0 } = options;
  const luminance = rgbaToLuminance(image);
  const result = dither
    ? floydSteinberg(luminance, image.width, image.height, invert)
    : thresholdToBitmap(luminance, image.width, image.height, threshold, invert);

  if (rotate === 0) {
    return result;
  }
  return rotateBitmap(result, rotate);
}

export function rgbaToLuminance(image: RawImageData): Float32Array {
  const luminance = new Float32Array(image.width * image.height);
  for (let i = 0; i < luminance.length; i += 1) {
    const r = image.data[i * 4]!;
    const g = image.data[i * 4 + 1]!;
    const b = image.data[i * 4 + 2]!;
    const a = image.data[i * 4 + 3]! / 255;
    const lum = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    const composited = ((1 - a) * 255) + (a * lum);
    luminance[i] = composited / 255;
  }
  return luminance;
}

export function thresholdToBitmap(
  luminance: Float32Array,
  width: number,
  height: number,
  threshold: number,
  invert: boolean,
): LabelBitmap {
  const rowBytes = Math.ceil(width / 8);
  const data = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const dark = (luminance[idx]! * 255) < threshold;
      const isBlack = invert ? !dark : dark;
      if (isBlack) {
        const byteIdx = y * rowBytes + Math.floor(x / 8);
        data[byteIdx]! |= 1 << (7 - (x % 8));
      }
    }
  }
  return { widthPx: width, heightPx: height, data };
}
