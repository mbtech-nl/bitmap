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

export type DitherMethod =
  | 'floyd-steinberg'
  | 'atkinson'
  | 'stucki'
  | 'jarvis-judice-ninke'
  | 'bayer4'
  | 'bayer8';

export type LuminanceWeights = 'bt709' | 'bt601' | readonly [number, number, number];

export interface ImageRenderOptions {
  /**
   * Threshold for black/white conversion (0–255). Ignored when `dither` is set
   * to a method or `true`; dither methods always quantise at the midpoint.
   * @default 128
   */
  threshold?: number;

  /**
   * Dither method.
   * - `false` (default): no dithering, hard threshold at `threshold`.
   * - `true`: alias for `'floyd-steinberg'` (backward compatible with v1.0).
   * - method string: use the named algorithm.
   * @default false
   */
  dither?: boolean | DitherMethod;

  /**
   * Invert the output bitmap.
   * @default false
   */
  invert?: boolean;

  /**
   * Rotate the rendered bitmap. Applied last, after threshold/dither.
   * @default 0
   */
  rotate?: 0 | 90 | 180 | 270;

  /**
   * Stretch the luminance histogram so the darkest visible pixel becomes 0
   * and the brightest becomes 1, before gamma and threshold/dither.
   * Applied per-image; flat (all-same-value) inputs are passed through.
   * @default false
   */
  autoLevels?: boolean;

  /**
   * Gamma correction applied to luminance before threshold/dither.
   * Output = pow(L, gamma).
   * - `gamma < 1` brightens midtones.
   * - `gamma > 1` darkens midtones.
   * - `gamma === 1` is a no-op.
   * Must be a finite positive number; non-finite or non-positive values throw.
   * @default 1
   */
  gamma?: number;

  /**
   * RGB → luminance weights.
   * - `'bt709'` (default): 0.2126 / 0.7152 / 0.0722 — current behaviour.
   * - `'bt601'`: 0.299 / 0.587 / 0.114 — older NTSC standard.
   * - tuple: custom non-negative weights; must sum to ~1.0 (validated, ±1e-6 tolerance).
   * @default 'bt709'
   */
  luminanceWeights?: LuminanceWeights;
}

export type BuiltinFont = 'default8x8';

export interface FontMetrics {
  charWidth: number;
  charHeight: number;
}
