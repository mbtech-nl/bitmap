import { atkinson, bayer4, bayer8, floydSteinberg, jarvisJudiceNinke, stucki } from './dither.js';
import { applyGamma, autoLevels as applyAutoLevels, resolveWeights } from './pipeline.js';
import { rotateBitmap } from './transform.js';
import type {
  DitherMethod,
  ImageRenderOptions,
  LabelBitmap,
  LuminanceWeights,
  RawImageData,
} from './types.js';

export type Ditherer = (
  lum: Float32Array,
  w: number,
  h: number,
  invert: boolean,
  mask?: Uint8Array,
) => LabelBitmap;

const DITHERERS: Record<DitherMethod, Ditherer> = {
  'floyd-steinberg': floydSteinberg,
  atkinson,
  stucki,
  'jarvis-judice-ninke': jarvisJudiceNinke,
  bayer4,
  bayer8,
};

export function resolveDither(opt: boolean | DitherMethod | undefined): Ditherer | null {
  if (!opt) return null;
  if (opt === true) return floydSteinberg;
  return DITHERERS[opt];
}

/**
 * Convert RGBA pixel data to a packed 1bpp bitmap.
 *
 * Inside `renderImage` the pipeline runs in this fixed order; each step is
 * optional:
 *
 * ```
 * rgba → luminance(weights) → autoLevels → gamma → threshold | dither → rotate
 * ```
 *
 * For multi-colour printers (Brother QL-800 with red+black tape, two-colour
 * DYMO/Zebra), see {@link renderMultiPlaneImage} instead.
 *
 * @param image - RGBA pixel data; compatible with browser `ImageData`.
 * @param options - See {@link ImageRenderOptions}.
 * @returns A 1bpp `LabelBitmap` whose dimensions match the input (or are
 *   swapped when `rotate` is 90 or 270).
 * @throws {RangeError} If image dimensions are zero or `data.length` does
 *   not match `width * height * 4`. Also if `gamma` is non-finite or
 *   non-positive, or if a custom `luminanceWeights` tuple has invalid values.
 *
 * @example Hard-threshold a logo
 * ```ts
 * const bmp = renderImage(rgba, { threshold: 128 });
 * ```
 *
 * @example Atkinson-dither a photo, rotated for portrait printing
 * ```ts
 * const bmp = renderImage(rgba, { dither: 'atkinson', rotate: 90 });
 * ```
 *
 * @example Auto-enhance a low-contrast scan
 * ```ts
 * const bmp = renderImage(rgba, { autoLevels: true, dither: 'floyd-steinberg' });
 * ```
 */
export function renderImage(image: RawImageData, options: ImageRenderOptions = {}): LabelBitmap {
  if (image.width === 0 || image.height === 0) {
    throw new RangeError('image dimensions must be non-zero');
  }
  if (image.data.length !== image.width * image.height * 4) {
    throw new RangeError('image.data length does not match dimensions');
  }

  const {
    threshold = 128,
    dither = false,
    invert = false,
    rotate = 0,
    autoLevels = false,
    gamma = 1,
    luminanceWeights = 'bt709',
  } = options;

  const luminance = rgbaToLuminance(image, luminanceWeights);
  if (autoLevels) applyAutoLevels(luminance);
  if (gamma !== 1) applyGamma(luminance, gamma);

  const ditherFn = resolveDither(dither);
  const result = ditherFn
    ? ditherFn(luminance, image.width, image.height, invert)
    : thresholdToBitmap(luminance, image.width, image.height, threshold, invert);

  return rotate === 0 ? result : rotateBitmap(result, rotate);
}

export function rgbaToLuminance(
  image: RawImageData,
  weights: LuminanceWeights = 'bt709',
): Float32Array {
  const [wr, wg, wb] = resolveWeights(weights);
  const luminance = new Float32Array(image.width * image.height);
  for (let i = 0; i < luminance.length; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const r = image.data[i * 4]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const g = image.data[i * 4 + 1]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const b = image.data[i * 4 + 2]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const a = image.data[i * 4 + 3]! / 255;
    const lum = wr * r + wg * g + wb * b;
    const composited = (1 - a) * 255 + a * lum;
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
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const dark = luminance[idx]! * 255 < threshold;
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
