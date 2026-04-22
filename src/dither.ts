import type { LabelBitmap } from './types.js';

export function floydSteinberg(
  luminance: Float32Array,
  width: number,
  height: number,
  invert: boolean,
): LabelBitmap {
  const pixels = new Float32Array(luminance);
  const rowBytes = Math.ceil(width / 8);
  const data = new Uint8Array(height * rowBytes);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const oldPixel = pixels[idx]!;
      const newPixel = oldPixel < 0.5 ? 0 : 1;
      pixels[idx] = newPixel;
      const error = oldPixel - newPixel;

      if (x + 1 < width) {
        pixels[idx + 1]! += error * (7 / 16);
      }
      if (y + 1 < height) {
        if (x > 0) {
          pixels[idx + width - 1]! += error * (3 / 16);
        }
        pixels[idx + width]! += error * (5 / 16);
        if (x + 1 < width) {
          pixels[idx + width + 1]! += error * (1 / 16);
        }
      }

      const isBlack = invert ? newPixel === 1 : newPixel === 0;
      if (isBlack) {
        const byteIndex = y * rowBytes + Math.floor(x / 8);
        data[byteIndex]! |= 1 << (7 - (x % 8));
      }
    }
  }

  return { widthPx: width, heightPx: height, data };
}
