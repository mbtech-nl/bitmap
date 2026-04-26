// eslint-disable-next-line @typescript-eslint/no-import-type-side-effects
import { type LuminanceWeights } from './types.js';

const BT709: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];
const BT601: readonly [number, number, number] = [0.299, 0.587, 0.114];

export function resolveWeights(weights: LuminanceWeights): readonly [number, number, number] {
  if (weights === 'bt709') return BT709;
  if (weights === 'bt601') return BT601;
  const [r, g, b] = weights;
  if (r < 0 || g < 0 || b < 0) {
    throw new RangeError(
      `luminanceWeights must be non-negative (got [${String(r)}, ${String(g)}, ${String(b)}])`,
    );
  }
  const sum = r + g + b;
  if (Math.abs(sum - 1) > 1e-6) {
    throw new RangeError(`luminanceWeights must sum to 1.0 (got ${String(sum)})`);
  }
  return weights;
}

export function autoLevels(luminance: Float32Array): Float32Array {
  if (luminance.length === 0) return luminance;
  let min = Infinity;
  let max = -Infinity;
  for (const v of luminance) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  // 1/255 = "less than one 8-bit luminance step of dynamic range" — treat as flat.
  // Stretching such input would amplify quantisation noise.
  if (range < 1 / 255) return luminance;
  const scale = 1 / range;
  for (let i = 0; i < luminance.length; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    luminance[i] = (luminance[i]! - min) * scale;
  }
  return luminance;
}

export function applyGamma(luminance: Float32Array, gamma: number): Float32Array {
  if (!Number.isFinite(gamma) || gamma <= 0) {
    throw new RangeError('gamma must be a finite number > 0');
  }
  if (gamma === 1) return luminance;
  for (let i = 0; i < luminance.length; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const v = luminance[i]!;
    luminance[i] = v <= 0 ? 0 : Math.pow(v, gamma);
  }
  return luminance;
}
