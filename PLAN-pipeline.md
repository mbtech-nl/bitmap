# @mbtech-nl/bitmap — Pipeline Expansion Plan

> Adds three error-diffusion dithers (Atkinson, Stucki, Jarvis–Judice–Ninke),
> one ordered/Bayer dither, plus three pre-quantisation pipeline steps:
> dynamic remap, gamma correction, and configurable luminance weights.
>
> Out of scope: CLAHE, resize. Those are tracked in [PLAN-clahe.md](PLAN-clahe.md).
>
> Pipeline order after this plan lands:
>
>     rgba → luminance(weights) → autoLevels → gamma → threshold | dither → rotate
>
> Rotate stays at the end (operating on the 1bpp output) because the new
> pipeline steps are all per-pixel and orientation-independent. Moving rotate
> to the RGBA buffer is unnecessary for this plan and is deferred to the
> CLAHE plan, where the tile grid is orientation-dependent.

---

## 0. Compatibility & consumer impact

> Read this before reviewing the rest of the plan. The headline:
> **existing v1.0.x consumers do not need to change any code** when this
> ships. The version after this lands should be `1.1.0` (additive features,
> no behaviour change for default options).

### Runtime compatibility

- `renderImage(image)` with no options produces byte-identical output to v1.0.x.
  This is enforced by the `'v1.0 default behaviour is unchanged'` snapshot
  captured in step 1 of §7 — if it ever drifts, CI fails.
- `renderImage(image, { dither: true })` continues to use Floyd–Steinberg.
- `renderImage(image, { dither: false })` continues to hard-threshold at 128.
- `floydSteinberg(...)` keeps its exact signature and behaviour — it just
  delegates to the new shared `errorDiffusion` driver internally.
- All other public exports (`renderText`, `rotateBitmap`, `getRow`, …) are
  untouched.

### Type-level compatibility

- New fields on `ImageRenderOptions` (`gamma`, `autoLevels`, `luminanceWeights`)
  are all optional — purely additive.
- `ImageRenderOptions.dither` widens from `boolean` to `boolean | DitherMethod`.
  This is a strict widening: every value previously assignable (`true`, `false`,
  `undefined`) is still assignable. The only consumer code that could break is
  code that re-narrows the field, e.g.:

  ```typescript
  const flag: boolean = opts.dither ?? false; // TS error after the widening
  ```

  This pattern is unusual; if a consumer hits it, the fix is `Boolean(opts.dither)`
  or switching to the new union. We treat this as acceptable for a minor bump.
- `DitherMethod` and `LuminanceWeights` are new exported types — no conflict
  with existing exports.

### What downstream driver authors need to know

The main consumers of this package are thermal-label printer drivers
(`labelmanager-ts`, `labelwriter-ts`, `brother-ql-ts`) and the
`@labelkit/designer-core` higher-level layout package. **None of them
need code changes.** `renderImage` remains the only entry point for
RGBA→1bpp conversion; all new functionality is opt-in via additional
optional fields on `ImageRenderOptions`.

Concretely, here is everything new that a consumer can now pass to
`renderImage(image, options)`:

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `dither` (widened) | `boolean \| DitherMethod` | `false` | Was `boolean` only; now also accepts `'floyd-steinberg'`, `'atkinson'`, `'stucki'`, `'jarvis-judice-ninke'`, `'bayer4'`, `'bayer8'`. `true` is still an alias for `'floyd-steinberg'`. |
| `autoLevels` | `boolean` | `false` | Stretches the luminance histogram so the darkest pixel becomes pure black and the brightest pure white before threshold/dither. Best knob to wire into an "auto-enhance" toggle. |
| `gamma` | `number` | `1` | Pow-curve correction applied to luminance. `< 1` brightens midtones, `> 1` darkens. Per-printer darkness calibration knob. |
| `luminanceWeights` | `'bt709' \| 'bt601' \| [r, g, b]` | `'bt709'` | RGB-to-grey weights. Default is unchanged BT.709. Switch to `'bt601'` only to match legacy tool output; tuples are a niche power-user knob (e.g. red-channel-only). |

No new top-level imports are needed. No existing imports change. The only
public-API surface that moves at all is `ImageRenderOptions.dither` (type
widening only, see "Type-level compatibility" above).

#### Worked examples

Existing call — unchanged:

```typescript
const bmp = renderImage(image, { dither: true });
```

Switch to crisper Atkinson output for logos and photos — one-character
edit at the call site:

```typescript
const bmp = renderImage(image, { dither: 'atkinson' });
```

Driver exposing a darkness slider, auto-enhance toggle, and dither
choice to its own users:

```typescript
const bmp = renderImage(image, {
  dither: userPrefs.ditherMethod,        // e.g. 'floyd-steinberg' | 'bayer4'
  autoLevels: userPrefs.autoEnhance,
  gamma: printerCalibration.gamma,       // e.g. 1.15 for a printer that prints light
});
```

Matching legacy output of a tool that used BT.601 weights:

```typescript
const bmp = renderImage(image, { luminanceWeights: 'bt601' });
```

### When to use what (rough guide for driver authors)

| Content type | Recommended setting |
| --- | --- |
| Already-1-bit content (text, QR, barcodes, line drawings) | `dither: false` (default threshold) |
| Logos with sharp edges and flat fills | `dither: false`, or `dither: 'atkinson'` if anti-aliased |
| Photos — smoothest gradient | `dither: 'jarvis-judice-ninke'` or `'stucki'` |
| Photos — crispest, most contrast | `dither: 'atkinson'` |
| Photos — balanced default | `dither: 'floyd-steinberg'` (or `dither: true`) |
| Repeating patterns, posters, pixel-art aesthetics | `dither: 'bayer4'` or `'bayer8'` |
| Speed-critical inner loop | `dither: 'bayer4'` (no error propagation) |

| Pipeline knob | When to reach for it |
| --- | --- |
| `gamma` | Per-printer darkness calibration — set once per printer model. |
| `autoLevels` | Scanned/photographed input with low contrast or wash-out. |
| `luminanceWeights: 'bt601'` | Only when matching legacy output of a previous tool that used BT.601. |
| `luminanceWeights: [...]` | Niche — picking a specific channel (e.g. red-only for receipts printed from coloured originals). |

### Recommended migration narrative (for driver release notes)

> "v1.1 of `@mbtech-nl/bitmap` adds Atkinson / Stucki / Jarvis–Judice–Ninke
> and Bayer ordered dithering, plus optional gamma, auto-levels, and
> configurable luminance weights. **All existing calls keep working with
> identical output.** To opt in, pass the new options to `renderImage`."

---

## 1. Goals & non-goals

**Goals**

- Add Atkinson, Stucki, Jarvis–Judice–Ninke, and Bayer (4×4 + 8×8) dither methods.
- Refactor `floydSteinberg` and the new error-diffusion methods onto a single
  shared `errorDiffusion(luminance, width, height, invert, kernel)` helper.
- Expose dither method selection through `ImageRenderOptions.dither`.
- Add `ImageRenderOptions.gamma`, `autoLevels`, `luminanceWeights`.
- Maintain backward compatibility with the existing public API: `dither: true`
  must continue to mean Floyd–Steinberg, `dither: false` continues to threshold.

**Non-goals**

- No CLAHE — separate plan.
- No resize — separate plan.
- No change to `LabelBitmap` shape, `renderText`, or any transform.
- No change to default luminance weights (BT.709 stays the default).
- **No new public exports beyond the `DitherMethod` and `LuminanceWeights`
  type aliases.** All new functionality is reachable through
  `renderImage(image, options)`. The new dither functions, pipeline
  helpers, and `rgbaToLuminance` stay internal. Promoting any of them to
  the public barrel is a separate decision triggered by real consumer
  demand, not by this plan.

---

## 2. Public API surface (after this plan)

### Updated `src/types.ts`

```typescript
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
   * to a method or `true`.
   * @default 128
   */
  threshold?: number;

  /**
   * Dither method.
   * - `false` (default): no dithering, hard threshold.
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
   * @default 1
   */
  gamma?: number;

  /**
   * RGB → luminance weights used by `rgbaToLuminance`.
   * - `'bt709'` (default): 0.2126 / 0.7152 / 0.0722 — current behaviour.
   * - `'bt601'`: 0.299 / 0.587 / 0.114 — older NTSC standard.
   * - tuple: custom weights; must sum to ~1.0 (validated, ±1e-6 tolerance).
   * @default 'bt709'
   */
  luminanceWeights?: LuminanceWeights;
}
```

### Updated `src/index.ts` exports

Add to the existing barrel:

```typescript
export type { DitherMethod, LuminanceWeights } from './types.js';
```

That is the **only** addition to the barrel — two type exports.

The new dither functions (`atkinson`, `stucki`, `jarvisJudiceNinke`,
`bayer4`, `bayer8`) and the new pipeline helpers (`applyGamma`,
`autoLevels`, `resolveWeights`) are intentionally **not** added to the
public barrel. Consumers reach all of this functionality through
`renderImage` options instead. Reasons:

- Keeps the consumer story simple: one entry point, options object,
  done. No need for callers to ever touch a `Float32Array` luminance
  buffer or know what BT.709 means.
- Smaller public surface = fewer breaking-change risks in future minor
  releases. We can refactor the kernel-table layout, change the in-place
  contract, or fuse passes without coordinating with consumers.
- `floydSteinberg` stays exported only because it was already public in
  v1.0; removing it would be a breaking change. Treat it as
  v1.0-compatibility-only and **do not** rely on it from new driver
  code — use `dither: 'floyd-steinberg'` (or `dither: true`) instead.
  Future major bump may demote it.
- `rgbaToLuminance` stays internal for the same reason — promoting it
  is a separate decision once we see real demand from a driver author.
  "Internal" here means *not on the `src/index.ts` barrel*. The function
  symbol is still `export`-ed from `src/image.ts` because intra-package
  imports rely on it, but it is not part of the published API surface.
  Deep imports into `dist/image.js` are explicitly **not supported** —
  consumers should treat it as private and the next major bump may move
  or rename it without notice.

If a driver later needs to compose a custom pipeline (e.g. CLAHE between
its own pre-processing and a dither method), that is the trigger to
revisit publishing the low-level building blocks. Until then, **keep
the surface small.**

---

## 3. New module: `src/pipeline.ts`

Holds the per-pixel pre-quantisation steps. Keeping them out of `image.ts`
makes them independently testable and reusable from custom pipelines.

```typescript
// eslint-disable-next-line @typescript-eslint/no-import-type-side-effects
import { type LuminanceWeights } from './types.js';

const BT709: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];
const BT601: readonly [number, number, number] = [0.299, 0.587, 0.114];

export function resolveWeights(weights: LuminanceWeights): readonly [number, number, number] {
  if (weights === 'bt709') return BT709;
  if (weights === 'bt601') return BT601;
  const [r, g, b] = weights;
  if (r < 0 || g < 0 || b < 0) {
    throw new RangeError(`luminanceWeights must be non-negative (got [${r}, ${g}, ${b}])`);
  }
  const sum = r + g + b;
  if (Math.abs(sum - 1) > 1e-6) {
    throw new RangeError(`luminanceWeights must sum to 1.0 (got ${sum})`);
  }
  return weights;
}

/**
 * Linearly stretch `luminance` so its observed min becomes 0 and observed max
 * becomes 1. Mutates the input in place and returns it. If max - min is below
 * 1/255 (effectively flat), the array is left unchanged.
 */
export function autoLevels(luminance: Float32Array): Float32Array {
  if (luminance.length === 0) return luminance;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < luminance.length; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const v = luminance[i]!;
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

/**
 * Apply gamma correction in place. `gamma === 1` is a no-op (early return).
 * Non-finite (NaN/Infinity) or non-positive gamma throws.
 */
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
```

**Decisions captured:**

- In-place mutation: every pre-quantisation step works in place on the
  Float32Array allocated by `rgbaToLuminance`. This avoids per-step allocations
  and matches the way `floydSteinberg` already copies once at entry.
- `autoLevels` is no-op below 1/255 dynamic range — prevents amplifying
  quantisation noise on flat images.
- Custom weight tuples are validated to sum to ~1 **and** be non-negative.
  Negative weights would let luminance go below 0 and out of range; arbitrary
  positive weights would let it exceed 1 and break dither thresholds.
- `applyGamma` rejects `NaN`, `Infinity`, and `<= 0`. Using `Number.isFinite`
  rather than `!(gamma > 0)` catches `Infinity` (which §8 requires).

---

## 4. Refactored `src/dither.ts`

Single shared error-diffusion driver, plus four named exports. Kernels are
encoded as flat arrays of `[dx, dy, weight]` triples to keep iteration simple.

```typescript
// eslint-disable-next-line @typescript-eslint/no-import-type-side-effects
import { type LabelBitmap } from './types.js';

interface ErrorDiffusionKernel {
  readonly name: string;
  /** Tuples of [dx, dy, weight]. Weights must sum to ≤ 1. */
  readonly offsets: readonly (readonly [number, number, number])[];
}

const FLOYD_STEINBERG: ErrorDiffusionKernel = {
  name: 'floyd-steinberg',
  // Order is load-bearing for byte-equivalence with v1.0 output: right, BL, B, BR.
  // Floating-point error accumulation differs if you reorder these, so do not
  // "tidy" this list — the v1.0 regression snapshot will catch a drift, but the
  // diagnosis is much easier if the order matches the existing imperative code
  // in the original src/dither.ts.
  offsets: [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ],
};

const ATKINSON: ErrorDiffusionKernel = {
  name: 'atkinson',
  // Atkinson diffuses only 6/8 of the error — the remaining 2/8 is dropped.
  offsets: [
    [1, 0, 1 / 8],
    [2, 0, 1 / 8],
    [-1, 1, 1 / 8],
    [0, 1, 1 / 8],
    [1, 1, 1 / 8],
    [0, 2, 1 / 8],
  ],
};

const STUCKI: ErrorDiffusionKernel = {
  name: 'stucki',
  offsets: [
    [1, 0, 8 / 42], [2, 0, 4 / 42],
    [-2, 1, 2 / 42], [-1, 1, 4 / 42], [0, 1, 8 / 42], [1, 1, 4 / 42], [2, 1, 2 / 42],
    [-2, 2, 1 / 42], [-1, 2, 2 / 42], [0, 2, 4 / 42], [1, 2, 2 / 42], [2, 2, 1 / 42],
  ],
};

const JJN: ErrorDiffusionKernel = {
  name: 'jarvis-judice-ninke',
  offsets: [
    [1, 0, 7 / 48], [2, 0, 5 / 48],
    [-2, 1, 3 / 48], [-1, 1, 5 / 48], [0, 1, 7 / 48], [1, 1, 5 / 48], [2, 1, 3 / 48],
    [-2, 2, 1 / 48], [-1, 2, 3 / 48], [0, 2, 5 / 48], [1, 2, 3 / 48], [2, 2, 1 / 48],
  ],
};

function errorDiffusion(
  luminance: Float32Array,
  width: number,
  height: number,
  invert: boolean,
  kernel: ErrorDiffusionKernel,
): LabelBitmap {
  const pixels = new Float32Array(luminance);
  const rowBytes = Math.ceil(width / 8);
  const data = new Uint8Array(height * rowBytes);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const oldPixel = pixels[idx]!;
      const newPixel = oldPixel < 0.5 ? 0 : 1;
      pixels[idx] = newPixel;
      const error = oldPixel - newPixel;

      for (let k = 0; k < kernel.offsets.length; k += 1) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const [dx, dy, w] = kernel.offsets[k]!;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny >= height) continue;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        pixels[ny * width + nx]! += error * w;
      }

      const isBlack = invert ? newPixel === 1 : newPixel === 0;
      if (isBlack) {
        const byteIndex = y * rowBytes + Math.floor(x / 8);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        data[byteIndex]! |= 1 << (7 - (x % 8));
      }
    }
  }

  return { widthPx: width, heightPx: height, data };
}

export function floydSteinberg(luminance: Float32Array, width: number, height: number, invert: boolean): LabelBitmap {
  return errorDiffusion(luminance, width, height, invert, FLOYD_STEINBERG);
}
export function atkinson(luminance: Float32Array, width: number, height: number, invert: boolean): LabelBitmap {
  return errorDiffusion(luminance, width, height, invert, ATKINSON);
}
export function stucki(luminance: Float32Array, width: number, height: number, invert: boolean): LabelBitmap {
  return errorDiffusion(luminance, width, height, invert, STUCKI);
}
export function jarvisJudiceNinke(luminance: Float32Array, width: number, height: number, invert: boolean): LabelBitmap {
  return errorDiffusion(luminance, width, height, invert, JJN);
}
```

### Bayer (ordered) dither

Different shape — no error propagation. Kept in the same file for cohesion.

```typescript
// 4x4 Bayer matrix, normalised to [0, 1).
const BAYER_4: readonly number[] = [
   0,  8,  2, 10,
  12,  4, 14,  6,
   3, 11,  1,  9,
  15,  7, 13,  5,
].map(v => (v + 0.5) / 16);

// 8x8 Bayer matrix (standard recursive construction).
const BAYER_8: readonly number[] = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
].map(v => (v + 0.5) / 64);

function ordered(
  luminance: Float32Array,
  width: number,
  height: number,
  invert: boolean,
  matrix: readonly number[],
  matrixSize: 4 | 8,
): LabelBitmap {
  const rowBytes = Math.ceil(width / 8);
  const data = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const t = matrix[(y % matrixSize) * matrixSize + (x % matrixSize)]!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const dark = luminance[y * width + x]! < t;
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

export function bayer4(luminance: Float32Array, width: number, height: number, invert: boolean): LabelBitmap {
  return ordered(luminance, width, height, invert, BAYER_4, 4);
}
export function bayer8(luminance: Float32Array, width: number, height: number, invert: boolean): LabelBitmap {
  return ordered(luminance, width, height, invert, BAYER_8, 8);
}
```

**Decisions captured:**

- Bayer matrices use the `(v + 0.5) / N²` normalisation so the threshold for
  a 50%-grey input falls cleanly between matrix steps (no off-by-one against
  pure 0.5 inputs).
- Ordered and error-diffusion methods share the same `(luminance, width,
  height, invert) → LabelBitmap` signature so `image.ts` can dispatch through
  a method map without conditionals.

---

## 5. Updated `src/image.ts`

```typescript
import {
  atkinson,
  bayer4,
  bayer8,
  floydSteinberg,
  jarvisJudiceNinke,
  stucki,
} from './dither.js';
import { applyGamma, autoLevels as applyAutoLevels, resolveWeights } from './pipeline.js';
import { rotateBitmap } from './transform.js';
// eslint-disable-next-line @typescript-eslint/no-import-type-side-effects
import {
  type DitherMethod,
  type ImageRenderOptions,
  type LabelBitmap,
  type LuminanceWeights,
  type RawImageData,
} from './types.js';

type Ditherer = (lum: Float32Array, w: number, h: number, invert: boolean) => LabelBitmap;

const DITHERERS: Record<DitherMethod, Ditherer> = {
  'floyd-steinberg': floydSteinberg,
  atkinson,
  stucki,
  'jarvis-judice-ninke': jarvisJudiceNinke,
  bayer4,
  bayer8,
};

function resolveDither(opt: boolean | DitherMethod | undefined): Ditherer | null {
  if (!opt) return null;
  if (opt === true) return floydSteinberg;
  return DITHERERS[opt];
}

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

export function rgbaToLuminance(image: RawImageData, weights: LuminanceWeights = 'bt709'): Float32Array {
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
```

`thresholdToBitmap` is unchanged.

**Decisions captured:**

- `rgbaToLuminance` keeps its old signature compatible: the second parameter
  has a default. Existing internal call sites need no change.
- Pipeline ordering inside `renderImage`: weights → autoLevels → gamma →
  threshold/dither → rotate. This matches the competitor's recommended order
  (minus CLAHE/resize) and keeps each step optional.
- The `threshold` option only affects the no-dither path. All dither methods
  (error-diffusion and Bayer) quantise at a fixed midpoint of `0.5` in
  normalised luminance. This matches v1.0 `floydSteinberg` and is what callers
  expect from a dither method — `threshold` is for hard binarisation, not for
  biasing dither output. To "darken" dithered output, use `gamma > 1` or shift
  weights/levels upstream.

---

## 6. Test plan

All new tests live alongside the existing ones. Coverage thresholds in
`vitest.config.ts` (95/95/90/95) must continue to pass.

### `src/__tests__/dither.test.ts` — additions

For each of `atkinson`, `stucki`, `jarvisJudiceNinke`, `bayer4`, `bayer8`:

```typescript
it('all-white input produces all-zero output');
it('all-black input produces all-set output');
it('mid-grey (0.5) produces 35–65% black pixels on a 32x32 field');
it('does not write out of bounds on 1x1 input');
it('invert flag swaps black and white');
it('data length matches heightPx * ceil(widthPx / 8)');
it('trailing bits in each row are zero');
it('snapshot: 16x8 horizontal gradient matches known output');
```

Plus shared:

```typescript
it('error-diffusion methods leave the input luminance Float32Array unchanged');
it('bayer4 / bayer8 are deterministic — same input yields same output across calls');
it('bayer matrix tiles correctly for widths/heights not divisible by matrix size');
```

### `src/__tests__/pipeline.test.ts` — new file

```typescript
describe('resolveWeights', () => {
  it('returns BT.709 for "bt709"');
  it('returns BT.601 for "bt601"');
  it('passes through a tuple summing to 1');
  it('throws if a tuple does not sum to ~1');
  it('accepts tuples within ±1e-6 of summing to 1');
  it('throws if any tuple component is negative');
});

describe('autoLevels', () => {
  it('flat input is unchanged');
  it('input with min=0.2 max=0.8 is stretched to span 0..1');
  it('idempotent: running twice produces the same result as running once');
  it('handles a single-pixel array');
  it('handles an empty array without throwing');
  it('mutates input in place and returns the same reference');
});

describe('applyGamma', () => {
  it('gamma === 1 is a no-op');
  it('gamma === 2 squares each value');
  it('gamma === 0.5 takes the square root of each value');
  it('throws for gamma <= 0');
  it('throws for NaN gamma');
  it('throws for Infinity gamma');
  it('throws for -Infinity gamma');
  it('clamps negative input to 0 (no NaN from pow)');
  it('mutates input in place');
});
```

### `src/__tests__/image.test.ts` — additions

```typescript
it('dither: "atkinson" produces non-uniform output for mid-grey input');
it('dither: "bayer4" tiles a 5x5 mid-grey image deterministically');
it('dither: true is a synonym for "floyd-steinberg" (byte-identical output)');

it('autoLevels stretches a low-contrast input before threshold');
it('autoLevels has no effect on a flat input');

it('gamma=2 darkens midtones — fewer black pixels than gamma=1 at threshold=128');
it('gamma=0.5 brightens midtones — more black pixels than gamma=1 at threshold=128');
it('gamma=1 produces output identical to omitting the option');

it('luminanceWeights="bt601" produces different output than "bt709" on a red-dominant input');
it('luminanceWeights default ("bt709") matches v1.0 reference snapshot for a known image');
it('luminanceWeights tuple [1,0,0] picks only the red channel');
it('luminanceWeights tuple summing to 0.9 throws');

it('pipeline order: autoLevels runs before gamma (verified via known fixture)');
// Fixture for the order test: a 4x4 image with luminance values { 0.4, 0.6 }
// (range 0.2). With autoLevels-then-gamma=2 the values become { 0, 1 } then
// { 0, 1 }; with gamma=2-then-autoLevels they become { 0.16, 0.36 } then
// { 0, 1 }. Both end at the same extremes, so use a wider value spread:
// { 0.2, 0.4, 0.6, 0.8 } — order-A and order-B differ in the two interior
// values. The test asserts the two interior bytes match the order-A result.
it('snapshot: full pipeline (autoLevels + gamma=1.5 + atkinson) on a 32x32 gradient');
```

### Regression guards

A single test in `image.test.ts` named `'v1.0 default behaviour is unchanged'`
must compare a fixed RGBA fixture rendered with no options against a snapshot
captured **before** any code change. Capture this snapshot in step 1 below,
not after the refactor.

---

## 7. Implementation order

> Do not proceed to step N+1 if tests for step N are failing.
> Do not skip writing tests — they are part of each step.
> If a step turns out to be wrong or blocked, append to **§10 Decision &
> Blocker Log** instead of working around silently.

```
1. Capture v1.0 regression snapshot
   - Add the 'v1.0 default behaviour is unchanged' test in image.test.ts
     using the current (unchanged) renderImage. Run it once, commit the
     snapshot. This locks in current output before any refactor.

2. src/pipeline.ts
   - Implement resolveWeights, autoLevels, applyGamma.
   - Add src/__tests__/pipeline.test.ts. All tests pass.

3. Refactor src/dither.ts (no API change yet)
   - Introduce ErrorDiffusionKernel, errorDiffusion(), and rewrite
     floydSteinberg() to delegate to it. Existing dither.test.ts must pass
     unchanged (including the snapshot test on the 16x8 gradient).
   - If the refactored Floyd-Steinberg snapshot drifts, STOP. Investigate
     the kernel iteration order before changing the snapshot.

4. Add new error-diffusion exports
   - Implement atkinson, stucki, jarvisJudiceNinke.
   - Add tests for each (see §6). All pass.

5. Add Bayer exports
   - Implement bayer4, bayer8 + the shared `ordered()` helper.
   - Add tests. All pass.

6. Wire types
   - Add DitherMethod, LuminanceWeights to src/types.ts.
   - Extend ImageRenderOptions with autoLevels, gamma, luminanceWeights,
     and the widened `dither` type.
   - Update src/index.ts barrel.

7. Wire image.ts
   - Add the DITHERERS dispatch table and resolveDither().
   - Apply autoLevels + gamma in pipeline order.
   - Pass luminanceWeights through to rgbaToLuminance.
   - All existing image.test.ts cases continue to pass (regression snapshot
     from step 1 is the load-bearing one).

8. Add new image.test.ts cases (see §6).

9. Documentation
   - Update README.md API table with the new options and methods.
   - Add a short "pipeline order" section linking back to this plan.

10. Verify CI command chain locally:
    pnpm typecheck && pnpm lint && prettier --check src && pnpm test:coverage && pnpm build
```

---

## 8. Edge cases to assert explicitly

- 1×1 input for every dither method (no neighbours to diffuse to).
- Single-row input for error-diffusion methods (no row below).
- Width not divisible by 8 — trailing bits zero, regardless of method.
- Width not divisible by Bayer matrix size — tiling wraps correctly.
- Empty Float32Array input to `autoLevels` and `applyGamma` — no throw, no
  out-of-bounds.
- `gamma` of `Infinity` or `NaN` — must throw.
- Custom luminance weights `[0, 0, 1]` — exercises the path where blue
  dominates (verifies weights are actually being applied).

---

## 9. Performance & memory notes

- The shared `errorDiffusion` driver iterates the kernel offsets per pixel
  via array destructuring. If profiling later shows this is hot, the
  destructuring can be replaced with parallel typed arrays — but only with
  evidence. **No premature optimisation.**
- All pre-quantisation steps are in place on the same Float32Array. Net
  allocations for the new pipeline: zero beyond what v1.0 already did.
- Bayer methods do not allocate a working buffer — they read luminance and
  write directly to the 1bpp data array.

---

## 10. Decision & Blocker Log

> Append entries here as implementation proceeds. Each entry: ISO date,
> short heading, one paragraph. Use `### Decisions` for choices that
> closed off alternatives, and `### Blockers` for anything that stopped
> progress (a failing test, a missing dependency, an upstream bug, an
> unclear requirement). Do not delete entries — flip them to "Resolved"
> with a follow-up paragraph.

### Decisions

- **2026-04-26 — `applyGamma` rejects non-finite values, not just `<= 0`.**
  The original guard `!(gamma > 0)` would have allowed `Infinity` through
  (since `Infinity > 0`), contradicting the §8 edge-case requirement that
  `Infinity`/`NaN` must throw. Hardened to
  `!Number.isFinite(gamma) || gamma <= 0`. Two extra tests added in §6
  (`'throws for Infinity gamma'`, `'throws for -Infinity gamma'`).
- **2026-04-26 — Floyd–Steinberg kernel offset order is load-bearing.**
  The refactor onto the shared `errorDiffusion` driver iterates kernel
  offsets in array order; floating-point error accumulation is
  order-dependent, so the new `FLOYD_STEINBERG.offsets` list keeps the
  exact order of the v1.0 imperative code (right, BL, B, BR). Documented
  inline in §4. The v1.0 regression snapshot (step 1 of §7) is the
  back-stop if anyone "tidies" the array.
- **2026-04-26 — `resolveWeights` rejects negative components.** The
  validation originally only checked the sum. A tuple like
  `[1.5, -0.3, -0.2]` sums to 1 but produces out-of-range luminance,
  which then escapes into dither thresholds. Tightened to require
  every component `>= 0` and explicit error message lists the
  offending tuple. Test added in §6 ("throws if any tuple component is
  negative").
- **2026-04-26 — `autoLevels` flat-input cutoff documented inline.**
  `range < 1/255` is "less than one 8-bit luminance step of dynamic
  range" — stretching that would amplify quantisation noise. Comment
  added in pipeline.ts (§3) so the `1/255` is not read as a magic
  constant.
- **2026-04-26 — `threshold` does not affect dither methods.** Documented
  in JSDoc on the `threshold` field and called out explicitly in §5.
  All dither methods quantise at `0.5` in normalised luminance, matching
  v1.0 `floydSteinberg`. To bias dither output, use `gamma` or input
  preprocessing.
- **2026-04-26 — `rgbaToLuminance` is "off the barrel" but still
  `export`-ed from its source file.** Deep imports into `dist/image.js`
  are explicitly unsupported. Documented in §2.
- **2026-04-26 — Pipeline-order test uses a 4-value fixture, not 2.**
  A two-value `{ 0.4, 0.6 }` fixture collapses to identical extremes
  under both orderings of (autoLevels, gamma) — useless as an order
  test. Switched to `{ 0.2, 0.4, 0.6, 0.8 }`, where the two interior
  values diverge between orderings. Documented inline in §6.
- **2026-04-26 — No `image.ts` TODO/anchor for the future
  rotate-in-pipeline rework.** Reviewer asked whether to leave a comment
  near the `rotate` call pointing at PLAN-clahe.md. Decision: keep
  `image.ts` pristine. The plan docs (this file + PLAN-clahe.md §0) are
  the source of truth for pipeline ordering decisions; production code
  should not narrate them. PLAN-clahe.md §9 records the corresponding
  decision on the CLAHE side.

### Blockers

_No entries yet — append as you implement._

---

## 11. Progress checklist

Mirror this in `progress.md` once work begins.

- [ ] 1. Capture v1.0 regression snapshot
- [ ] 2. Implement `src/pipeline.ts` + tests
- [ ] 3. Refactor `dither.ts` onto `errorDiffusion`, existing tests still pass
- [ ] 4. Add Atkinson / Stucki / JJN + tests
- [ ] 5. Add Bayer4 / Bayer8 + tests
- [ ] 6. Extend `types.ts` and `index.ts`
- [ ] 7. Wire `image.ts` for new options
- [ ] 8. Add `image.test.ts` cases for new options
- [ ] 9. Update README
- [ ] 10. Verify full CI chain locally
