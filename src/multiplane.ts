import { resolveDither, thresholdToBitmap } from './image.js';
import { applyGamma, autoLevels as applyAutoLevels } from './pipeline.js';
import { rotateBitmap } from './transform.js';
import type {
  LabelBitmap,
  MultiPlaneRenderOptions,
  PaletteEntry,
  PlaneRenderOptions,
  RawImageData,
} from './types.js';

const RESERVED_NAME = 'white';
const MAX_PALETTE_ENTRIES = 254;

/**
 * Test-only escape hatch that runs the per-plane dither without the mask.
 * Lives off the public type so consumers must reach for it via a cast and
 * a `@ts-expect-error`. Exists solely so the regression test in
 * `multiplane.test.ts` can prove the mask is doing real work.
 */
interface InternalMultiPlaneOptions extends MultiPlaneRenderOptions {
  __unsafeDisableMask?: boolean;
}

export function renderMultiPlaneImage(
  image: RawImageData,
  options: MultiPlaneRenderOptions,
): Record<string, LabelBitmap> {
  validate(image, options);
  const { palette, colorSpace = 'rgb', defaults = {}, planes = {}, rotate = 0 } = options;
  const unsafeDisableMask = (options as InternalMultiPlaneOptions).__unsafeDisableMask === true;
  const { width, height } = image;
  const nPixels = width * height;

  // 0 = implicit white background, 1..N = palette[i-1].
  const classification = new Uint8Array(nPixels);
  const intensity = new Float32Array(nPixels);
  classifyPixels(image.data, width, height, palette, colorSpace, classification, intensity);

  const result: Record<string, LabelBitmap> = {};
  for (let p = 0; p < palette.length; p += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const entry = palette[p]!;
    const planeOpts: PlaneRenderOptions = { ...defaults, ...(planes[entry.name] ?? {}) };

    const luminance = new Float32Array(nPixels);
    const mask = new Uint8Array(nPixels);
    const planeIdx = p + 1;
    for (let i = 0; i < nPixels; i += 1) {
      if (classification[i] === planeIdx) {
        // Inverted: high colour-closeness → dark luminance → ink.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        luminance[i] = 1 - intensity[i]!;
        mask[i] = 1;
      } else {
        // Background within this plane's buffer. Inert: 1.0 never crosses
        // any threshold, and mask = 0 forbids error-diffusion leakage.
        luminance[i] = 1;
        mask[i] = 0;
      }
    }

    if (planeOpts.autoLevels === true) applyAutoLevels(luminance);
    if (planeOpts.gamma !== undefined && planeOpts.gamma !== 1) {
      applyGamma(luminance, planeOpts.gamma);
    }

    const ditherFn = resolveDither(planeOpts.dither);
    const threshold = planeOpts.threshold ?? 128;
    const bmp = ditherFn
      ? ditherFn(luminance, width, height, false, unsafeDisableMask ? undefined : mask)
      : thresholdToBitmap(luminance, width, height, threshold, false);

    result[entry.name] = rotate === 0 ? bmp : rotateBitmap(bmp, rotate);
  }

  return result;
}

function validate(image: RawImageData, options: MultiPlaneRenderOptions): void {
  if (image.width === 0 || image.height === 0) {
    throw new RangeError('image dimensions must be non-zero');
  }
  if (image.data.length !== image.width * image.height * 4) {
    throw new RangeError('image.data length does not match dimensions');
  }
  const { palette } = options;
  if (palette.length === 0) {
    throw new RangeError('palette must contain at least one entry');
  }
  if (palette.length > MAX_PALETTE_ENTRIES) {
    throw new RangeError(
      `palette must have at most ${String(MAX_PALETTE_ENTRIES)} entries (got ${String(palette.length)})`,
    );
  }
  const seenNames = new Set<string>();
  const seenRgb = new Set<number>();
  for (const entry of palette) {
    if (entry.name === RESERVED_NAME) {
      throw new RangeError(
        `palette entry name '${RESERVED_NAME}' is reserved for the implicit background`,
      );
    }
    if (seenNames.has(entry.name)) {
      throw new RangeError(`duplicate palette entry name: '${entry.name}'`);
    }
    seenNames.add(entry.name);
    const [r, g, b] = entry.rgb;
    if (
      !Number.isInteger(r) ||
      !Number.isInteger(g) ||
      !Number.isInteger(b) ||
      r < 0 ||
      r > 255 ||
      g < 0 ||
      g > 255 ||
      b < 0 ||
      b > 255
    ) {
      throw new RangeError(
        `palette entry '${entry.name}' has invalid rgb [${String(r)}, ${String(g)}, ${String(b)}]`,
      );
    }
    if (r === 255 && g === 255 && b === 255) {
      throw new RangeError(
        `palette entry '${entry.name}' has rgb [255, 255, 255] which collides with the implicit white background`,
      );
    }
    const key = (r << 16) | (g << 8) | b;
    if (seenRgb.has(key)) {
      throw new RangeError(
        `duplicate palette entry rgb: [${String(r)}, ${String(g)}, ${String(b)}]`,
      );
    }
    seenRgb.add(key);
  }
}

// ---------- classifier ----------

function classifyPixels(
  rgba: Uint8Array,
  width: number,
  height: number,
  palette: readonly PaletteEntry[],
  colorSpace: 'rgb' | 'lab',
  classification: Uint8Array,
  intensity: Float32Array,
): void {
  if (colorSpace === 'lab') {
    classifyPixelsLab(rgba, width, height, palette, classification, intensity);
  } else {
    classifyPixelsRgb(rgba, width, height, palette, classification, intensity);
  }
}

function classifyPixelsRgb(
  rgba: Uint8Array,
  width: number,
  height: number,
  palette: readonly PaletteEntry[],
  classification: Uint8Array,
  intensity: Float32Array,
): void {
  const N = palette.length;
  const radius = computeRgbRadii(palette);
  const nPixels = width * height;

  for (let i = 0; i < nPixels; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const ar = rgba[i * 4]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const ag = rgba[i * 4 + 1]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const ab = rgba[i * 4 + 2]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const aa = rgba[i * 4 + 3]! / 255;
    // Composite against white substrate before classification (matches
    // rgbaToLuminance's convention).
    const r = (1 - aa) * 255 + aa * ar;
    const g = (1 - aa) * 255 + aa * ag;
    const b = (1 - aa) * 255 + aa * ab;

    // Distance to implicit white (idx 0).
    let bestIdx = 0;
    let bestDist = distSquaredRgb(r, g, b, 255, 255, 255);

    for (let p = 0; p < N; p += 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const [pr, pg, pb] = palette[p]!.rgb;
      const d = distSquaredRgb(r, g, b, pr, pg, pb);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = p + 1;
      }
    }

    classification[i] = bestIdx;
    if (bestIdx === 0) {
      intensity[i] = 0;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const r0 = radius[bestIdx - 1]!;
      const t = 1 - Math.sqrt(bestDist) / r0;
      intensity[i] = t < 0 ? 0 : t > 1 ? 1 : t;
    }
  }
}

function classifyPixelsLab(
  rgba: Uint8Array,
  width: number,
  height: number,
  palette: readonly PaletteEntry[],
  classification: Uint8Array,
  intensity: Float32Array,
): void {
  const N = palette.length;
  const paletteLab: [number, number, number][] = palette.map(p =>
    rgbToLab(p.rgb[0], p.rgb[1], p.rgb[2]),
  );
  const whiteLab = rgbToLab(255, 255, 255);
  const radius = computeLabRadii(paletteLab, whiteLab);
  const nPixels = width * height;

  for (let i = 0; i < nPixels; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const ar = rgba[i * 4]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const ag = rgba[i * 4 + 1]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const ab = rgba[i * 4 + 2]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const aa = rgba[i * 4 + 3]! / 255;
    const r = (1 - aa) * 255 + aa * ar;
    const g = (1 - aa) * 255 + aa * ag;
    const b = (1 - aa) * 255 + aa * ab;
    const [L, a, bv] = rgbToLab(r, g, b);

    let bestIdx = 0;
    let bestDist = distSquared3(L, a, bv, whiteLab[0], whiteLab[1], whiteLab[2]);

    for (let p = 0; p < N; p += 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const [pL, pA, pB] = paletteLab[p]!;
      const d = distSquared3(L, a, bv, pL, pA, pB);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = p + 1;
      }
    }

    classification[i] = bestIdx;
    if (bestIdx === 0) {
      intensity[i] = 0;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const r0 = radius[bestIdx - 1]!;
      const t = 1 - Math.sqrt(bestDist) / r0;
      intensity[i] = t < 0 ? 0 : t > 1 ? 1 : t;
    }
  }
}

function distSquaredRgb(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

function distSquared3(
  a1: number,
  b1: number,
  c1: number,
  a2: number,
  b2: number,
  c2: number,
): number {
  const da = a1 - a2;
  const db = b1 - b2;
  const dc = c1 - c2;
  return da * da + db * db + dc * dc;
}

function computeRgbRadii(palette: readonly PaletteEntry[]): Float64Array {
  const N = palette.length;
  const out = new Float64Array(N);
  for (let p = 0; p < N; p += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [r, g, b] = palette[p]!.rgb;
    let nearest = distSquaredRgb(r, g, b, 255, 255, 255);
    for (let q = 0; q < N; q += 1) {
      if (q === p) continue;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const [qr, qg, qb] = palette[q]!.rgb;
      const d = distSquaredRgb(r, g, b, qr, qg, qb);
      if (d < nearest) nearest = d;
    }
    out[p] = Math.sqrt(nearest) / 2;
  }
  return out;
}

function computeLabRadii(
  paletteLab: readonly [number, number, number][],
  whiteLab: readonly [number, number, number],
): Float64Array {
  const N = paletteLab.length;
  const out = new Float64Array(N);
  for (let p = 0; p < N; p += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [L, a, b] = paletteLab[p]!;
    let nearest = distSquared3(L, a, b, whiteLab[0], whiteLab[1], whiteLab[2]);
    for (let q = 0; q < N; q += 1) {
      if (q === p) continue;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const [qL, qA, qB] = paletteLab[q]!;
      const d = distSquared3(L, a, b, qL, qA, qB);
      if (d < nearest) nearest = d;
    }
    out[p] = Math.sqrt(nearest) / 2;
  }
  return out;
}

// ---------- sRGB → CIELAB (D65) ----------

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const D65_XN = 0.95047;
const D65_YN = 1.0;
const D65_ZN = 1.08883;

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);
  const X = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / D65_XN;
  const Y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) / D65_YN;
  const Z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / D65_ZN;
  const fx = labF(X);
  const fy = labF(Y);
  const fz = labF(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
