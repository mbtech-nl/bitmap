/**
 * A 1-bit-per-pixel bitmap. Row-major, MSB-first within each byte.
 *
 * Memory layout:
 *   Row y, pixel x -> byte index: y * bytesPerRow + Math.floor(x / 8)
 *                  -> bit index:  7 - (x % 8)   (MSB = leftmost pixel)
 *
 * A set bit (1) = black dot. A clear bit (0) = white dot.
 */
export interface LabelBitmap {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly data: Uint8Array;
}

/**
 * Raw RGBA image data, compatible with browser ImageData and
 * @napi-rs/canvas ImageData.
 */
export interface RawImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface TextRenderOptions {
  font?: BuiltinFont;
  scaleX?: number;
  scaleY?: number;
  letterSpacing?: number;
  invert?: boolean;
}

export interface ImageRenderOptions {
  threshold?: number;
  dither?: boolean;
  invert?: boolean;
  rotate?: 0 | 90 | 180 | 270;
}

export type BuiltinFont = 'default8x8';

export interface FontMetrics {
  charWidth: number;
  charHeight: number;
}
