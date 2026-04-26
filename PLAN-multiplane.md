# @mbtech-nl/bitmap — Multi-Plane Output Plan

> Adds N-plane bitmap output for printers that print more than one
> ink/foil colour per label (e.g. Brother QL-800 + DK-22251 red/black,
> some DYMO and Zebra two-colour models). Each plane is its own 1bpp
> `LabelBitmap`; **all output planes are mutually exclusive** — no pixel
> is ever set in more than one plane, because most printers cannot put
> two colours on the same dot position.
>
> Out of scope: CLAHE (PLAN-clahe.md), resize, hardware-specific frame
> formatting (each driver still bundles its plane buffers in its own
> wire format).
>
> Pipeline shape after this plan lands:
>
>     rgba → classify → for each palette entry P:
>                         (luminance_P + mask_P)
>                       → autoLevels_P → gamma_P
>                       → threshold | dither (mask-aware)
>                       → rotate
>                       → LabelBitmap_P
>
> Mutual exclusivity is a **construction property**, not a post-hoc
> repair: each pixel is routed to one plane (or the implicit white
> background), and per-plane error-diffusion dither is masked so error
> never leaks into pixels classified to other planes. See §4 and §6.

---

## 0. Compatibility & consumer impact

- Purely additive. `renderImage` and every other v1.1 export keep
  identical behaviour byte-for-byte. The v1.0 and v1.1 regression
  snapshots in `image.test.ts` continue to be the load-bearing
  back-stops.
- **One internal-but-observable change:** the dither functions
  (`floydSteinberg`, `atkinson`, `stucki`, `jarvisJudiceNinke`,
  `bayer4`, `bayer8`) gain an optional `mask?: Uint8Array` parameter.
  Callers that omit it (which is everyone today, including
  `renderImage`) get unchanged behaviour. This is a strict signature
  widening.
- New top-level entry point: `renderMultiPlaneImage(image, options)`,
  returning `Record<string, LabelBitmap>` keyed by palette entry name.
- Recommended next version: `1.2.0` (additive features, no behaviour
  change for default options).

---

## 1. Goals & non-goals

**Goals**

- Accept a caller-supplied palette of N entries (the printer hardware
  knows which colours it can put down; the driver passes that in).
- Classify each source pixel to exactly one palette entry, or to the
  implicit white background.
- Build one Float32 luminance buffer plus one Uint8 mask per plane and
  run the existing pre-quantisation pipeline (`autoLevels`, `gamma`)
  per-plane, with per-plane overrides.
- Run threshold or dither per plane, with **error-diffusion masked** so
  no pixel routed to another plane can be flipped on by error leakage.
- Produce mutually exclusive plane bitmaps. Verify with worst-case test
  fixtures and a pairwise-XOR assertion (§6).
- Default colour space: RGB Euclidean. CIELAB ΔE as opt-in.

**Non-goals**

- No printer-specific frame formatting. Drivers compose plane buffers
  into their own wire formats (Brother raster headers, DYMO command
  blocks, etc.). This package returns plane bitmaps; the driver does
  the rest.
- No "soft" multi-plane where a single source pixel contributes
  fractional ink to multiple planes. Most multi-colour thermal printers
  cannot fire two heads on the same dot, so the package matches the
  hardware constraint.
- No CLAHE composition. CLAHE is per-plane luminance and orthogonal —
  if both ship, CLAHE runs inside the per-plane pipeline like
  `autoLevels` and `gamma` do. Out of scope here; revisit when CLAHE
  ships.
- No new public exports beyond `PaletteEntry`, `PlaneRenderOptions`,
  `MultiPlaneRenderOptions`, and `renderMultiPlaneImage`. The
  classifier and per-plane orchestration stay internal.

---

## 2. Public API surface (after this plan)

### Updated `src/types.ts`

```typescript
export interface PaletteEntry {
  /** Plane identifier — used as the key in the result Record. Must be unique within the palette and not 'white' (reserved). */
  readonly name: string;
  /** RGB tuple in 0..255. */
  readonly rgb: readonly [number, number, number];
}

/**
 * Per-plane pre-quantisation overrides. Any field omitted falls back
 * to `MultiPlaneRenderOptions.defaults`, then to that field's hard
 * default in `renderImage` (e.g. threshold: 128, dither: false).
 */
export interface PlaneRenderOptions {
  threshold?: number;
  dither?: boolean | DitherMethod;
  invert?: boolean;
  autoLevels?: boolean;
  gamma?: number;
}

export interface MultiPlaneRenderOptions {
  /** Printer's palette. Length ≥ 1, names unique, name !== 'white'. */
  readonly palette: readonly PaletteEntry[];

  /**
   * Distance metric for classification.
   * - `'rgb'` (default): Euclidean distance in 0..255 RGB space. Fast, predictable, fine for designed assets.
   * - `'lab'`: CIELAB ΔE (D65). Perceptually correct; small overhead. Use when palette colours are perceptually close.
   * @default 'rgb'
   */
  colorSpace?: 'rgb' | 'lab';

  /** Defaults applied to every plane unless an entry exists in `planes`. */
  defaults?: PlaneRenderOptions;

  /** Per-plane overrides keyed by palette entry name. */
  planes?: Readonly<Record<string, PlaneRenderOptions>>;

  /**
   * Rotation applied to every plane after threshold/dither, exactly as
   * in `renderImage`. All planes rotate together — independent rotation
   * makes no physical sense for a multi-colour print.
   * @default 0
   */
  rotate?: 0 | 90 | 180 | 270;
}
```

### Updated `src/index.ts` exports

```typescript
export type {
  PaletteEntry,
  PlaneRenderOptions,
  MultiPlaneRenderOptions,
} from './types.js';
export { renderMultiPlaneImage } from './multiplane.js';
```

That is the **only** addition to the barrel — three type exports and
one function. The classifier (`classifyPixels`), the LAB conversion
helper, and the masked error-diffusion entry point stay internal,
following the same surface-minimisation rationale as PLAN-pipeline.md
§2.

### Worked example

```typescript
import { renderMultiPlaneImage } from '@mbtech-nl/bitmap';

// Brother QL-800 with DK-22251 red/black tape.
const { black, red } = renderMultiPlaneImage(image, {
  palette: [
    { name: 'black', rgb: [0, 0, 0] },
    { name: 'red',   rgb: [204, 0, 0] },
  ],
  defaults: { dither: 'floyd-steinberg' },
  planes: {
    // Red tape on this printer prints a touch lighter — calibrate.
    red: { gamma: 1.15 },
  },
  rotate: 90,
});

// `black` and `red` are independent LabelBitmaps. They are guaranteed
// to be mutually exclusive: for every pixel position, at most one of
// the two has its bit set.
```

---

## 3. New module: `src/multiplane.ts`

Holds `renderMultiPlaneImage` plus the private classifier. Lives in its
own file (not `pipeline.ts`) because the contract is different — it
operates on RGBA, not on a Float32Array luminance.

```typescript
import { resolveDither } from './image.js';        // exposed internally
import { applyGamma, autoLevels as applyAutoLevels } from './pipeline.js';
import { rotateBitmap } from './transform.js';
// eslint-disable-next-line @typescript-eslint/no-import-type-side-effects
import {
  type LabelBitmap,
  type MultiPlaneRenderOptions,
  type PlaneRenderOptions,
  type RawImageData,
} from './types.js';

const RESERVED_NAME = 'white';

export function renderMultiPlaneImage(
  image: RawImageData,
  options: MultiPlaneRenderOptions,
): Record<string, LabelBitmap> {
  validate(image, options);
  const { palette, colorSpace = 'rgb', defaults = {}, planes = {}, rotate = 0 } = options;
  const { width, height } = image;
  const nPixels = width * height;

  // Classification: 0 = implicit white background, 1..N = palette[i-1].
  const classification = new Uint8Array(nPixels);
  const intensity = new Float32Array(nPixels);
  classifyPixels(image.data, width, height, palette, colorSpace, classification, intensity);

  const result: Record<string, LabelBitmap> = {};
  for (let p = 0; p < palette.length; p += 1) {
    const entry = palette[p]!;
    const planeOpts: PlaneRenderOptions = { ...defaults, ...(planes[entry.name] ?? {}) };

    const luminance = new Float32Array(nPixels);
    const mask = new Uint8Array(nPixels);
    const planeIdx = p + 1;
    for (let i = 0; i < nPixels; i += 1) {
      if (classification[i] === planeIdx) {
        // Inverted: high intensity = strongly this colour = dark in luminance terms.
        luminance[i] = 1 - intensity[i]!;
        mask[i] = 1;
      } else {
        luminance[i] = 1;  // background within this plane's buffer
        mask[i] = 0;
      }
    }

    if (planeOpts.autoLevels) applyAutoLevels(luminance);
    if (planeOpts.gamma !== undefined && planeOpts.gamma !== 1) {
      applyGamma(luminance, planeOpts.gamma);
    }

    const ditherFn = resolveDither(planeOpts.dither);
    const invert = planeOpts.invert ?? false;
    const bmp = ditherFn
      ? ditherFn(luminance, width, height, invert, mask)
      : thresholdToBitmap(luminance, width, height, planeOpts.threshold ?? 128, invert);

    result[entry.name] = rotate === 0 ? bmp : rotateBitmap(bmp, rotate);
  }

  return result;
}
```

`thresholdToBitmap` is reused unchanged. `resolveDither` already exists
in `image.ts`; export it internally for `multiplane.ts` to consume
(off the public barrel).

**Decisions captured in this section:**

- `classification` is `Uint8Array`. `0` = implicit white, `i+1` =
  `palette[i]`. Caps the palette at **N ≤ 254** entries; documented in
  §1 non-goals as fine for any plausible label printer.
- `intensity` is a `Float32Array` storing each classified pixel's
  closeness to its assigned palette colour. Computed once during
  classification; reused per-plane to avoid recomputing distances.
- Background pixels (classification === 0) appear as `luminance = 1.0,
  mask = 0` in *every* plane's buffer. This makes background pixels
  inert in every plane — luminance never gets touched and the mask
  forbids error from leaking in.

---

## 4. Refactor: optional `mask` on dither functions

Existing dither signature:

```typescript
type Ditherer = (lum: Float32Array, w: number, h: number, invert: boolean) => LabelBitmap;
```

New signature:

```typescript
type Ditherer = (
  lum: Float32Array,
  w: number,
  h: number,
  invert: boolean,
  mask?: Uint8Array,
) => LabelBitmap;
```

Inside `errorDiffusion`, the only change is one line in the kernel
inner loop:

```typescript
for (const [dx, dy, w] of kernel.offsets) {
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || nx >= width || ny >= height) continue;
  if (mask !== undefined && mask[ny * width + nx]! === 0) continue; // <-- LOAD-BEARING
  pixels[ny * width + nx]! += error * w;
}
```

That single conditional makes mutual exclusivity a property of the
algorithm: error from a foreground pixel can only ever land on
neighbours that are *also* in this plane's classified region.
Background pixels (mask = 0) are inert — their luminance stays 1.0
throughout the pipeline, and 1.0 never crosses the 0.5 quantisation
threshold, so the bit is never set.

**Why no mask on Bayer or threshold:**

- Bayer (`ordered`) makes a purely local decision: `lum[i] < matrix[...]`.
  Background luminance is 1.0; the maximum Bayer threshold is `(N²-0.5)/N²
  < 1` (e.g. 0.969 for 4×4, 0.992 for 8×8). 1.0 is never below any
  Bayer threshold, so background bits are never set. Safe by
  construction.
- `thresholdToBitmap` compares `lum * 255 < threshold` where threshold
  ≤ 255. Background `lum = 1.0` ⇒ `255 < threshold` is false for any
  threshold ≤ 255. Safe by construction.

The mask argument is only meaningful for error-diffusion dithers. We
add it to all dither functions for signature uniformity, but the
ordered/threshold paths can ignore it — and they will, because they
already produce correct output without one.

**Comment in `dither.ts`** (must land with the change):

> `mask` is load-bearing for `renderMultiPlaneImage` mutual exclusivity.
> See PLAN-multiplane.md §4 and §6. Removing this check will silently
> allow error to leak across plane boundaries; the regression test in
> `multiplane.test.ts` exists specifically to catch that.

---

## 5. Classifier

Implementation lives privately in `src/multiplane.ts`. Two colour
spaces:

### RGB Euclidean (default)

```typescript
function distRgbSquared(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}
```

(Squared distance — comparing distances doesn't need a `sqrt`. Only the
final intensity formula calls `Math.sqrt` once per pixel.)

### CIELAB ΔE (opt-in)

Standard sRGB → linear → XYZ → LAB pipeline with D65 white. Convert
each palette RGB *once* at the top of `classifyPixels`; convert each
source pixel as you walk it. The classifier path is then identical to
RGB but reads from the pre-converted palette LAB tuples.

### Classification per pixel

```
1. Composite RGBA against implicit white background using the alpha
   channel (same convention as `rgbaToLuminance`).
2. Distances = [d(pixel, white)] + [d(pixel, palette[i]) for i in 0..N-1].
3. nearestIdx = argmin(distances). 0 = white, 1..N = palette entries.
4. If nearestIdx === 0: classification[i] = 0, intensity[i] = 0.
   Else:
     classification[i] = nearestIdx
     intensity[i] = 1 - sqrt(distance) / classificationRadius(palette, nearestIdx-1)
                    clamped to [0, 1]
```

Where `classificationRadius(palette, p)` is the Euclidean distance
from `palette[p]` to its **nearest other palette entry (including the
implicit white)**, divided by 2 — i.e. the half-width of `palette[p]`'s
Voronoi cell. This makes the formula scale-correct: a pixel at the
exact palette colour has intensity 1.0; a pixel at the boundary
between two palette entries has intensity ~0.0.

**Tiebreak rule:** if two palette entries are equidistant, the earlier
entry in the palette array wins. Documented and tested.

**Decisions captured in this section:**

- Classification uses *squared* distances for the argmin pass; only the
  final intensity computation takes a square root. One sqrt per pixel.
- Intensity formula uses each palette entry's individual Voronoi
  half-width, not a global constant, so well-separated palettes don't
  bias intensity.
- Reserved name `'white'` for the implicit background. Validation
  rejects it in the palette to prevent ambiguity.

---

## 6. Test plan

All new tests live in two files:

- `src/__tests__/multiplane.test.ts` — new file, owns classifier and
  `renderMultiPlaneImage` cases including the mutual-exclusivity suite.
- `src/__tests__/dither.test.ts` — additions for the new `mask`
  parameter on dither functions.

### `dither.test.ts` additions

```typescript
describe.each(ERROR_DIFFUSION_METHODS)('%s with mask', (_name, dither) => {
  it('omitting mask is identical to passing all-ones mask', () => {
    const lum = makeFixture();
    const noMask = dither(lum, W, H, false);
    const onesMask = dither(lum, W, H, false, new Uint8Array(W * H).fill(1));
    expect(Array.from(onesMask.data)).toEqual(Array.from(noMask.data));
  });

  it('all-zero mask produces all-zero output regardless of luminance', () => {
    const lum = new Float32Array(W * H).fill(0); // all-black
    const bmp = dither(lum, W, H, false, new Uint8Array(W * H));
    expect(Array.from(bmp.data).every((b) => b === 0)).toBe(true);
  });

  it('error does not leak into masked-out neighbours', () => {
    // Single foreground pixel at (1, 1) with luminance 0.51 (worst case
    // for negative error leakage). Mask = 1 only at (1, 1). Run dither.
    // Inspect the internal pixels buffer (via a test helper that
    // returns the post-dither Float32Array): every position other than
    // (1, 1) must equal its initial value.
    /* ... */
  });
});

describe('Bayer with mask: still produces no out-of-mask bits', () => {
  it('bayer4 with mask = 0 outside foreground produces only in-mask bits', () => {
    const lum = new Float32Array(64).fill(0); // all-black request
    const mask = new Uint8Array(64);
    mask[0] = 1; // only top-left "allowed"
    // Note: bayer doesn't read mask, but background luminance was set to
    // 1 by renderMultiPlaneImage so no out-of-mask bit is set anyway.
    // This test actually goes through renderMultiPlaneImage to verify
    // the contract end-to-end.
  });
});
```

### `multiplane.test.ts` — mutual exclusivity (the load-bearing suite)

```typescript
function popcount(b: number): number {
  let n = 0;
  while (b) { n += b & 1; b >>>= 1; }
  return n;
}

function pairwiseCollisions(planes: Record<string, LabelBitmap>): number {
  const names = Object.keys(planes);
  let collisions = 0;
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = planes[names[i]!]!.data;
      const b = planes[names[j]!]!.data;
      for (let k = 0; k < a.length; k += 1) {
        collisions += popcount(a[k]! & b[k]!);
      }
    }
  }
  return collisions;
}

describe('renderMultiPlaneImage > mutual exclusivity', () => {
  // Fixture A: dense 1px red/black checkerboard. Every foreground pixel
  // is adjacent to a foreground pixel of the OTHER plane. If the mask
  // is missing, error-diffusion will leak across plane boundaries
  // immediately and pile up.
  it('dense red/black 1px checkerboard, FS dither: 0 collisions', () => {
    const planes = renderMultiPlaneImage(checkerboard(8, 8, [204, 0, 0], [0, 0, 0]), {
      palette: [
        { name: 'black', rgb: [0, 0, 0] },
        { name: 'red',   rgb: [204, 0, 0] },
      ],
      defaults: { dither: 'floyd-steinberg' },
    });
    expect(pairwiseCollisions(planes)).toBe(0);
  });

  // Fixture B: anti-aliased red text touching anti-aliased black text.
  // The AA edge pixels are intermediate-intensity foreground — the
  // worst case for negative-error leakage in error-diffusion methods.
  it.each(['floyd-steinberg', 'atkinson', 'stucki', 'jarvis-judice-ninke'] as const)(
    '%s on AA red-touching-black text: 0 collisions',
    (method) => {
      const planes = renderMultiPlaneImage(buildAARedBlackText(), {
        palette: [
          { name: 'black', rgb: [0, 0, 0] },
          { name: 'red',   rgb: [204, 0, 0] },
        ],
        defaults: { dither: method },
      });
      expect(pairwiseCollisions(planes)).toBe(0);
    },
  );

  // Fixture C: the geometric worst case for JJN's 12-cell forward
  // kernel. Every foreground pixel is at luminance 0.51 (just above
  // threshold, so error = -0.49 leaks at maximum magnitude).
  it('jarvis-judice-ninke on luminance-0.51 dense foreground: 0 collisions', () => {
    const planes = renderMultiPlaneImage(buildBoundaryFixture(0.51), {
      palette: [
        { name: 'black', rgb: [0, 0, 0] },
        { name: 'red',   rgb: [204, 0, 0] },
      ],
      defaults: { dither: 'jarvis-judice-ninke' },
    });
    expect(pairwiseCollisions(planes)).toBe(0);
  });

  // Fixture D: 3-plane stress test mixing dither methods per plane.
  it('3-plane palette (black/red/blue) with mixed dither methods: 0 collisions', () => {
    const planes = renderMultiPlaneImage(buildThreePaletteFixture(), {
      palette: [
        { name: 'black', rgb: [0,   0,   0]   },
        { name: 'red',   rgb: [204, 0,   0]   },
        { name: 'blue',  rgb: [0,   0,   204] },
      ],
      planes: {
        black: { dither: 'floyd-steinberg' },
        red:   { dither: 'atkinson' },
        blue:  { dither: 'bayer4' },
      },
    });
    expect(pairwiseCollisions(planes)).toBe(0);
  });

  // Fixture E: the regression test that asserts the mask check is
  // load-bearing. Uses an internal test-only `__unsafeDisableMask` flag
  // to run dither WITHOUT the mask check on the same fixture as B.
  // Asserts the unsafe path produces collisions > 0. If this test ever
  // PASSES with collisions === 0, someone has accidentally made
  // mutual exclusivity hold without the mask — verify and update
  // the contract; do NOT just delete the test.
  it('regression: removing the mask check WOULD break exclusivity', () => {
    const fixture = buildAARedBlackText();
    const safe = renderMultiPlaneImage(fixture, {
      palette: [
        { name: 'black', rgb: [0, 0, 0] },
        { name: 'red',   rgb: [204, 0, 0] },
      ],
      defaults: { dither: 'jarvis-judice-ninke' },
    });
    expect(pairwiseCollisions(safe)).toBe(0);

    const unsafe = renderMultiPlaneImage(fixture, {
      palette: [
        { name: 'black', rgb: [0, 0, 0] },
        { name: 'red',   rgb: [204, 0, 0] },
      ],
      defaults: { dither: 'jarvis-judice-ninke' },
      // @ts-expect-error: test-only escape hatch
      __unsafeDisableMask: true,
    });
    expect(pairwiseCollisions(unsafe)).toBeGreaterThan(0);
  });
});
```

The `__unsafeDisableMask` flag is the only escape hatch; it lives off
the public type and exists only so the regression test can prove the
mask is doing real work. Document it in the source as test-only and
**not** in the README.

### Classifier tests

```typescript
describe('classifyPixels (RGB)', () => {
  it('pure palette colour → classifies to that entry, intensity 1');
  it('pure white → classifies to background (idx 0), intensity 0');
  it('off-white (250, 250, 250) classifies to background, no dot');
  it('halfway between palette[0] and palette[1] tiebreak: palette[0] wins');
  it('alpha=0 composites to white → background');
  it('alpha=0.5 over red on white → composited grey-pink → classifies somewhere');
  it('intensity formula scales by per-entry Voronoi half-width');
});

describe('classifyPixels (LAB)', () => {
  it('two perceptually-close palette entries: LAB distinguishes; RGB may not');
  it('matches RGB for well-separated palettes (sanity)');
});
```

### Per-plane pipeline tests

```typescript
describe('renderMultiPlaneImage > per-plane options', () => {
  it('per-plane gamma overrides defaults');
  it('per-plane dither overrides defaults');
  it('omitting per-plane options falls back to defaults');
  it('omitting both per-plane and defaults falls back to renderImage hard defaults');
  it('rotate applies to every plane uniformly');
});
```

### Validation tests

```typescript
describe('renderMultiPlaneImage > validation', () => {
  it('empty palette throws');
  it('palette of 255 entries throws (Uint8Array overflow)');
  it('duplicate plane names throw');
  it("plane name 'white' throws (reserved)");
  it('rgb component out of [0, 255] throws');
  it('two palette entries at identical RGB throw');
  it('zero-dimension image throws');
  it('non-RGBA data throws');
});
```

### Snapshot tests

```typescript
it('snapshot: 32x32 designed-asset (red logo + black text on white)');
it('snapshot: same fixture with colorSpace = "lab" — may differ from RGB on edge pixels');
```

---

## 7. Implementation order

> Same rules as PLAN-pipeline.md / PLAN-clahe.md: do not advance to step
> N+1 if tests for step N are red. Append to **§10 Decision & Blocker
> Log** rather than silently working around something unexpected.

```
1. Pre-flight
   - Confirm v1.1 (PLAN-pipeline.md) has shipped. The v1.0/v1.1
     regression snapshots in image.test.ts must continue to pass
     throughout this work.

2. Add `mask?` parameter to dither functions
   - Update Ditherer signature in dither.ts.
   - Add the masked branch inside errorDiffusion's kernel loop.
   - Add the load-bearing comment referencing this plan.
   - Add dither.test.ts cases (§6 "with mask"). All existing tests
     pass unchanged.

3. Add types
   - PaletteEntry, PlaneRenderOptions, MultiPlaneRenderOptions in
     types.ts.
   - tsc passes.

4. Implement RGB classifier in src/multiplane.ts
   - classifyPixels (private), distance-squared core, Voronoi-half-width
     intensity formula.
   - Classifier unit tests.

5. Implement renderMultiPlaneImage
   - Per-plane buffer build.
   - Per-plane options merge (defaults + per-plane override).
   - Wire in masked dither.
   - Add the §6 mutual-exclusivity test suite. ALL tests pass with
     0 collisions on every fixture.
   - Add the regression test using __unsafeDisableMask. Verify that
     unsafe path produces collisions > 0 on fixture B/E.

6. Add LAB classification opt-in
   - sRGB → linear → XYZ → LAB conversion (D65 white).
   - Add classifier tests covering both modes.

7. Wire exports
   - Add the four exports to src/index.ts.

8. README
   - Add a "Multi-plane output" section with the Brother QL-800 worked
     example from §2.
   - Add a sentence in the "renderImage options" preamble pointing to
     renderMultiPlaneImage for two-colour printers.

9. Verify CI command chain locally
   pnpm typecheck && pnpm lint && prettier --check src && pnpm test:coverage && pnpm build
```

---

## 8. Edge cases to assert explicitly

- **Single-entry palette.** Behaves like a degenerate single-plane
  renderImage that classifies to the one colour. Pixels closer to white
  than to the palette entry produce no dot.
- **Palette of N = 254 entries.** Upper bound of `Uint8Array`-encoded
  classification. Should still work; no plausible printer reaches this.
- **Palette entry that is white-ish.** Reserved name `'white'`
  rejected in validation. Near-white palette entries (e.g. cream tape)
  are allowed but will steal pixels from the background classification —
  that's the caller's responsibility.
- **Two palette entries at identical RGB.** Throws. Ambiguous.
- **Pixel exactly equidistant from two palette entries.** Tiebreak by
  palette index (earlier wins). Documented and tested.
- **Image with alpha < 1.** Composite against white before classification
  (same convention as `rgbaToLuminance`).
- **A plane has zero classified pixels.** `result[entry.name]` is an
  all-zero `LabelBitmap` of correct dimensions; no errors.
- **All pixels classify to background.** All result bitmaps are
  all-zero. No errors.
- **Negative or > 255 RGB tuple values in the palette.** Throws via
  validation.

---

## 9. Performance & memory notes

- **Classification:** one pass over the image, O(W × H × N) for N
  palette entries. For typical N ∈ {2, 3} this is ~20M operations on
  a 768×512 source — sub-millisecond on any modern target.
- **Per-plane pipeline:** same as v1.1 single-plane × N. Each plane
  allocates its own Float32Array (W × H × 4 bytes) and Uint8Array mask
  (W × H bytes).
- **Total working memory:** for a 384×384 default thermal label, N=2:
  classification (144 KB) + intensity (576 KB) + per-plane luminance
  (576 KB × 2) + per-plane mask (144 KB × 2) ≈ 2.2 MB. Acceptable.
- **LAB conversion** adds an unnoticeable per-pixel cost compared to
  the dither pass that follows.
- **The masked-error branch** in `errorDiffusion` adds one comparison
  per (pixel, kernel-cell) iteration. For Floyd–Steinberg (4 cells)
  on a 384×384 image that's 590k extra comparisons — negligible. JJN
  (12 cells) triples that — still negligible.

---

## 10. Decision & Blocker Log

> Append entries here as implementation proceeds. Each entry: ISO date,
> short heading, one paragraph. Use `### Decisions` for choices that
> closed off alternatives, and `### Blockers` for anything that stopped
> progress. Do not delete entries — flip them to "Resolved" with a
> follow-up paragraph.

### Decisions

- **2026-04-27 — Separate function, not generalised `renderImage`.**
  Widening `renderImage` to optionally return multiple planes would
  change its return type and break every existing caller. Cleaner: a
  sibling `renderMultiPlaneImage`. Single-plane callers never touch
  the new function.
- **2026-04-27 — Mutual exclusivity by classifier construction +
  masked error diffusion, not post-hoc resolution.** Post-hoc
  XOR-then-resolve requires an arbitrary priority rule and silently
  drops dots; classifier-routes-once + mask-the-error-scatter makes
  exclusivity a property of the algorithm, with worst-case-fixture
  tests asserting `pairwiseCollisions === 0`.
- **2026-04-27 — Mask is added to existing `errorDiffusion` driver,
  not a parallel masked variant.** Adding an optional `mask?`
  parameter is a strict superset of the v1.1 signature; existing
  callers (including `renderImage`) pass `undefined` and get
  identical behaviour byte-for-byte. The single conditional in the
  inner loop is the only added cost.
- **2026-04-27 — Bayer and threshold paths do NOT take a mask
  argument's behaviour into the algorithm body.** Both produce
  correct output without one (background luminance 1.0 never crosses
  any Bayer or `< threshold` boundary). The signature accepts `mask?`
  for uniformity but the parameter is ignored in those code paths.
  This is documented in the dither.ts source so future work doesn't
  add a "redundant" mask check.
- **2026-04-27 — Default colour space is RGB Euclidean. LAB is
  opt-in.** Most label palettes are far apart in RGB; LAB only matters
  when palette entries are perceptually close, which is rare for
  designed assets. LAB ships in the same release behind a flag, so
  callers who do need it have it without waiting on a follow-up.
- **2026-04-27 — Classification stores palette index in a `Uint8Array`
  (cap N ≤ 254).** Uint16 would future-proof; Uint8 is half the
  memory. No real label printer goes past ~5 colours.
- **2026-04-27 — Implicit white background; name `'white'`
  reserved.** A printer-supplied palette describes inks, not the
  substrate. The substrate is always background and is implicit. If
  a future use case needs explicit-white-on-coloured-tape we'll
  revisit; until then, reserving the name keeps validation simple.
- **2026-04-27 — Test-only `__unsafeDisableMask` escape hatch.** The
  regression test (§6 fixture E) needs to run the unsafe path to
  prove the mask is doing real work. Exposed via a property that is
  not in the public type (so consumers can't reach it without a
  `@ts-expect-error`), and documented in the source as test-only.
- **2026-04-27 — Per-plane options merge order: hard defaults
  (`renderImage`) ← `defaults` ← `planes[name]`.** Last writer wins.
  Lets a caller set `defaults: { dither: 'floyd-steinberg' }` and
  override one plane with `planes: { red: { dither: 'atkinson' } }`.
- **2026-04-27 — `invert` is NOT exposed on `PlaneRenderOptions`.**
  Per-plane `invert: true` would treat background pixels (`lum = 1.0`)
  as `0.0` and set bits on every background and other-plane pixel,
  destroying mutual exclusivity. The non-error-diffusion paths
  (Bayer, threshold) cannot defend against this with a mask. Cleaner
  to drop the field outright; users who really want an inverted plane
  can post-process with `invertBitmap`. `RenderImageOptions.invert`
  on the single-plane `renderImage` is unaffected.
- **2026-04-27 — Validation rejects palette entries at exactly
  `[255, 255, 255]`.** A pure-white palette entry has zero distance to
  the implicit substrate background and would always lose the strict-
  `<` argmin tiebreak to white (idx 0), so it can never receive a
  pixel. Throwing is friendlier than silently producing an empty plane.
  Near-white entries (e.g. `[250, 250, 250]` for cream tape) are still
  permitted — those have distinct distances and can win pixels.
- **2026-04-27 — Intensity formula measures *colour-closeness*, not
  *darkness*.** A light-but-far-from-palette colour and a dark-but-
  equidistant colour produce similar intensity. This is correct for
  designed assets and anti-aliased text (the stated target) — the
  classifier routes by perceptual identity and dither density falls
  off near Voronoi boundaries. For photo-like input with dark off-
  palette colours the resulting plane will look weak; a future caller
  who needs photo support can pre-process with a colour-quantisation
  step before passing the result here.
- **2026-04-27 — Per-plane `autoLevels` runs over the whole plane
  buffer (background pixels included).** Background pixels are pinned
  to luminance 1.0, so `max` is always 1.0; only `min` (the darkest
  foreground pixel) drives the stretch. Net effect: each plane's
  foreground gets stretched to use the full [0, 1] range relative to
  its own substrate-white reference. This is the right behaviour
  here — but it's a subtle difference from single-plane
  `renderImage`, where `max` is whatever the brightest input pixel
  happens to be. Worth knowing if a caller compares the two.

### Blockers

- **2026-04-27 — `__unsafeDisableMask` regression test cannot produce
  collisions on any constructable fixture.** Implemented during step 5.
  Built the worst-case fixture from §6 (two bands at luminance 0.51,
  16×16, 32×32, up to 96×96; JJN), and additional adversarial layouts
  (dense alternating columns, single-pixel-foreground edge cases). All
  variants produced `pairwiseCollisions === 0` even with the mask check
  disabled.

  Investigation: error diffusion preserves total energy. Within the
  foreground band the per-cell error oscillates in sign (a cell at lum
  0.51 quantises to 1 with error -0.49; the next cell, having received
  -0.49 × 7/16 ≈ -0.21 of error, quantises to 0 with error +0.43; and
  so on). The boundary row below therefore receives a sum of
  alternating-sign errors whose magnitude is much smaller than any
  individual diffusion event, and never enough to push a `lum = 1.0`
  background cell below the 0.5 threshold.

  Resolution: the regression test as designed is unrealizable. Dropped
  it from `multiplane.test.ts` and replaced the load-bearing comment in
  `dither.ts` with one explaining that the mask is the *contract* — a
  hard guarantee that is invisible on benign inputs but the only
  defence against adversarial buffers. The `__unsafeDisableMask`
  escape hatch is retained for future probing. The positive
  mutual-exclusivity assertions (every fixture in §6 with the safe
  path produces 0 collisions) still gate CI.

  Follow-up: if a future contributor can construct a fixture where the
  unsafe path yields collisions > 0, restore the regression test using
  it. Suggested avenues not yet explored: feeding a non-naturally-
  generated luminance buffer (e.g. via custom `gamma` settings that
  push foreground luminance to a single-sided pathology), or the
  CLAHE plan landing first and producing a fixture with persistently
  one-sided errors.

---

## 11. Progress checklist

Mirror this in `progress.md` once work begins.

- [ ] 1. Pre-flight (v1.1 shipped, regression snapshots green)
- [ ] 2. Add `mask?` parameter to `errorDiffusion` + tests
- [ ] 3. Add types (`PaletteEntry`, `PlaneRenderOptions`, `MultiPlaneRenderOptions`)
- [ ] 4. RGB classifier + tests
- [ ] 5. `renderMultiPlaneImage` + per-plane pipeline + mutual-exclusivity tests
- [ ] 6. LAB classification opt-in + tests
- [ ] 7. Wire exports in `src/index.ts`
- [ ] 8. README
- [ ] 9. Verify full CI chain locally
