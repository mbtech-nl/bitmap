# @mbtech-nl/bitmap — CLAHE Plan

> Adds Contrast Limited Adaptive Histogram Equalization (CLAHE) as an
> optional pre-quantisation step. Source images are assumed to already be
> in the desired output orientation, so rotate is **not** part of the
> CLAHE-aware pipeline ordering — the existing `rotate` option in
> `renderImage` continues to apply at the end of the pipeline as a final
> 1bpp transform, exactly as it does today.
>
> Pipeline order after this plan lands (assuming PLAN-pipeline.md has
> already shipped):
>
>     rgba → luminance(weights) → CLAHE → autoLevels → gamma → threshold | dither → rotate
>
> CLAHE comes **before** autoLevels because CLAHE redistributes contrast
> locally; running autoLevels first would clamp the global range CLAHE
> wants to work with, then CLAHE would re-stretch it again — wasted work
> and slightly worse output.

---

## 0. Goals & non-goals

**Goals**

- Implement a correct, single-pass CLAHE: per-tile clipped histogram with
  uniform redistribution, then per-pixel bilinear interpolation between
  tile-centre CDFs.
- Expose CLAHE through `ImageRenderOptions` as a single nested option
  object (off by default).
- Integrate CLAHE into the `renderImage` pipeline at the documented
  position (luminance → CLAHE → autoLevels → gamma → ...).
- Provide an exported `applyCLAHE` for advanced/custom pipelines.

**Non-goals**

- No iterative redistribution (the strict CLAHE re-loop). Single-pass is
  good enough for thermal print and is what the donor implementation
  does. If we hit a real case where it isn't, that is a follow-up.
- No resize step. Resize is independent and tracked separately.
- No change to `LabelBitmap`, transforms, or text rendering.
- No rotate reordering: orientation is the caller's responsibility.

---

## 1. Donor function review

The starting point is the donor function discussed in the chat. It is a
real CLAHE implementation with all four required pieces (per-tile
histogram, clip + redistribute, CDF, bilinear interpolation between tile
centres). Three issues to fix on the way in:

1. **Out-of-bounds read in the lookup pass.** The histogram-build loop
   clamps `src[i]` to `[0, 255]` before indexing; the lookup loop does
   not. Negative or >255 luminance values would index `histograms`
   out-of-bounds and yield `undefined`. Fix: same clamp.
2. **Input scale.** Donor expects luminance in `0..255`. Our internal
   convention is `0..1` (Float32Array, normalised in `rgbaToLuminance`).
   We will keep our `0..1` convention and rewrite the donor to operate
   in that range. Bin index is `Math.floor(v * 255 + 0.5)` clamped to
   `[0, 255]`. CDF output is `(sum / nPixels)` (in `0..1`), not
   `(sum / nPixels) * 255`.
3. **Strict-null compliance.** Our tsconfig enables
   `noUncheckedIndexedAccess`; every typed-array read needs a `!`
   non-null assertion to match the rest of the codebase
   (see [src/dither.ts](src/dither.ts)).

Performance fix while we're in there:

4. **Closure in the hot loop.** The donor defines `getCDF` per pixel.
   Inline it. Pre-compute `histIdx` for the four neighbour tiles before
   the per-pixel loop body where possible. Keep this readable — no SIMD,
   no manual unrolling, no promises about throughput.

---

## 2. Public API surface

### `src/types.ts` — additions

```typescript
export interface CLAHEOptions {
  /**
   * Number of horizontal tiles. Must be a positive integer ≥ 1.
   * If `width / tilesX < 4`, CLAHE throws — tiles smaller than 4 pixels
   * produce numerically unstable histograms.
   * @default 8
   */
  tilesX?: number;

  /**
   * Number of vertical tiles. Same constraints as `tilesX`.
   * @default 8
   */
  tilesY?: number;

  /**
   * Clip limit, expressed as a multiplier on the per-bin uniform-histogram
   * count. A value of 1 means "no extra contrast" (every bin clipped to
   * uniform). 2–4 is the typical useful range. Must be ≥ 1.
   * @default 2
   */
  clipLimit?: number;
}
```

### `src/types.ts` — `ImageRenderOptions` extension

```typescript
export interface ImageRenderOptions {
  // ...existing fields from PLAN-pipeline.md...

  /**
   * Apply Contrast Limited Adaptive Histogram Equalization to the
   * luminance map before autoLevels and gamma. Useful for low-contrast
   * or unevenly lit photos. Off by default.
   *
   * Pass `true` for the default tile grid (8×8) and clip limit (2),
   * or an options object to tune.
   */
  clahe?: boolean | CLAHEOptions;
}
```

### `src/index.ts` — additions

```typescript
export type { CLAHEOptions } from './types.js';
export { applyCLAHE } from './pipeline.js';
```

---

## 3. New module surface in `src/pipeline.ts`

> This file already exists after PLAN-pipeline.md. CLAHE lives next to
> `autoLevels` and `applyGamma` because they share the same
> "Float32Array in [0, 1] → Float32Array in [0, 1]" contract.

```typescript
// eslint-disable-next-line @typescript-eslint/no-import-type-side-effects
import { type CLAHEOptions } from './types.js';

const HIST_BINS = 256;

/**
 * Apply Contrast Limited Adaptive Histogram Equalization in place.
 *
 * The input must be in [0, 1]. Values outside that range are clamped
 * for histogram bin lookup; the output is always within [0, 1].
 *
 * @throws {RangeError} If width/height do not match the array length,
 *   if tile counts are non-positive, if any tile would be smaller than
 *   4 pixels in either dimension, or if clipLimit < 1.
 */
export function applyCLAHE(
  luminance: Float32Array,
  width: number,
  height: number,
  options: CLAHEOptions = {},
): Float32Array;
```

Implementation outline (real code in step 3 of §6):

1. Validate inputs: `luminance.length === width * height`, tile counts ≥ 1
   integers, clipLimit ≥ 1, every tile ≥ 4 pixels in both axes.
2. Allocate `cdfs: Float32Array(tilesY * tilesX * 256)`. This is the only
   non-trivial allocation. For a default 8×8 grid that is 16384 floats
   (~64 KB).
3. **Build per-tile histograms** in `cdfs` (it doubles as a histogram
   buffer first, then becomes a CDF buffer).
4. **Clip + redistribute** per tile. Single pass (donor-equivalent).
5. **Convert each tile's clipped histogram to a normalised CDF** in place
   (`sum / nPixels`, output stays in `[0, 1]`).
6. **Interpolation pass.** For each output pixel:
   - Compute `tx = (x - tileSizeX/2) / tileSizeX`,
     `ty = (y - tileSizeY/2) / tileSizeY`.
   - `tx1 = floor(tx)`, `tx2 = tx1 + 1`, `fx = tx - tx1`. Same for y.
   - Clamp neighbour tile coordinates into `[0, tilesX-1]` /
     `[0, tilesY-1]`.
   - Compute the source pixel's bin: `bin = max(0, min(255, round(v *
     255)))`.
   - Bilinearly interpolate the four CDFs at `bin`.
   - Write the result back into `luminance[y * width + x]`.

The interpolation pass writes back to the same array we were reading from.
Because the read for pixel `(x, y)` is `luminance[y * width + x]` and the
write is to the same index, **and** the four CDF lookups depend only on
the source pixel's bin (not on any other already-written pixel), in-place
is safe. We will assert this with a test that compares in-place output to
a fresh-buffer reference implementation.

---

## 4. Updated `src/image.ts`

```typescript
import { applyCLAHE, applyGamma, autoLevels as applyAutoLevels, resolveWeights } from './pipeline.js';
// ...rest of imports unchanged...

export function renderImage(image: RawImageData, options: ImageRenderOptions = {}): LabelBitmap {
  // ...existing validation...

  const {
    threshold = 128,
    dither = false,
    invert = false,
    rotate = 0,
    autoLevels = false,
    gamma = 1,
    luminanceWeights = 'bt709',
    clahe = false,
  } = options;

  const luminance = rgbaToLuminance(image, luminanceWeights);

  if (clahe) {
    const claheOptions = clahe === true ? {} : clahe;
    applyCLAHE(luminance, image.width, image.height, claheOptions);
  }
  if (autoLevels) applyAutoLevels(luminance);
  if (gamma !== 1) applyGamma(luminance, gamma);

  // ...threshold/dither + rotate as before...
}
```

---

## 5. Test plan

### `src/__tests__/pipeline.test.ts` — additions

```typescript
describe('applyCLAHE', () => {
  describe('validation', () => {
    it('throws if luminance.length !== width * height');
    it('throws if tilesX < 1');
    it('throws if tilesY < 1');
    it('throws if tilesX is non-integer');
    it('throws if tilesY is non-integer');
    it('throws if clipLimit < 1');
    it('throws if width / tilesX < 4');
    it('throws if height / tilesY < 4');
    it('NaN clipLimit throws');
  });

  describe('correctness', () => {
    it('flat input → flat output (no contrast to redistribute)');
    it('all-zero input remains all-zero');
    it('all-one input remains all-one');
    it('output values are within [0, 1]');
    it('preserves total mean luminance to within 5% on a known fixture');
    it('improves local contrast: stddev of a low-contrast tile increases');
    it('clipLimit=1 → output ≈ flat (uniform CDF, no extra contrast)');
    it('higher clipLimit → larger local contrast amplification');
  });

  describe('boundary handling', () => {
    it('width not divisible by tilesX: last tile column is wider, no out-of-bounds');
    it('height not divisible by tilesY: last tile row is taller, no out-of-bounds');
    it('top-left corner pixel uses only the (0,0) tile CDF (clamped neighbours)');
    it('bottom-right corner pixel uses only the (tilesX-1, tilesY-1) tile CDF');
    it('does not write or read luminance values outside the array');
  });

  describe('numerical safety', () => {
    it('input with values slightly < 0 (e.g. from gamma rounding) does not crash');
    it('input with values slightly > 1 does not crash');
    it('NaN-free output for any valid input');
  });

  describe('in-place safety', () => {
    it('mutates input in place and returns the same reference');
    it('matches a fresh-buffer reference implementation byte-exact');
  });

  describe('snapshots', () => {
    it('snapshot: 32x32 linear gradient with default options');
    it('snapshot: 64x32 two-zone (dark left, bright right) image with default options');
    it('snapshot: 32x32 input with tilesX=4, tilesY=4, clipLimit=3');
  });
});
```

The "fresh-buffer reference implementation" lives in the test file as a
straightforward (non-in-place, no clamping shortcuts) port of the donor
algorithm. It is the oracle for the in-place version. Keep it under 50
lines and clearly marked as test-only.

### `src/__tests__/image.test.ts` — additions

```typescript
it('clahe: false is identical to omitting the option');
it('clahe: true uses default 8x8 tiles, clipLimit 2');
it('clahe runs before autoLevels (verified via known fixture)');
it('clahe runs before gamma (verified via known fixture)');
it('clahe + atkinson on a low-contrast photo: snapshot');
it('clahe options object overrides defaults');
it('clahe with too-small image throws via renderImage');
```

---

## 6. Implementation order

> Same rules as PLAN-pipeline.md: do not advance if tests for the current
> step are red. Append to **§9 Decision & Blocker Log** rather than
> silently working around something unexpected.

```
1. Pre-flight
   - Confirm PLAN-pipeline.md has shipped (autoLevels, gamma,
     luminanceWeights are in place). If not, finish that plan first.
   - Re-read the donor function and the chat thread reviewing it. Note
     the four issues in §1 of this file before writing code.

2. CLAHEOptions type
   - Add CLAHEOptions to src/types.ts.
   - Extend ImageRenderOptions with `clahe?: boolean | CLAHEOptions`.
   - tsc passes; no behaviour change.

3. Reference (oracle) implementation in test file
   - Write a fresh-buffer, no-shortcut, easy-to-read port of the donor
     algorithm directly inside src/__tests__/pipeline.test.ts as
     `referenceCLAHE(...)`. Apply the four fixes from §1 (clamp,
     [0,1] scale, strict-null, but no closure-inlining — readability
     first here, this is the oracle).
   - Add a placeholder test that calls referenceCLAHE on a known input
     and snapshots the output. This snapshot is the contract the
     production version must match.

4. Production applyCLAHE in src/pipeline.ts
   - Implement the in-place, performance-aware version per §3.
   - Add validation (§5 "validation" tests).
   - Run the in-place-vs-reference equivalence test from step 3 — must
     match byte-exact.

5. Correctness, boundary, numerical-safety tests
   - Add the §5 test cases. All pass.

6. Wire into renderImage
   - Update src/image.ts per §4.
   - Pipeline order: luminance → CLAHE → autoLevels → gamma →
     threshold/dither → rotate.
   - Add image.test.ts cases for CLAHE integration.
   - The 'v1.0 default behaviour is unchanged' regression snapshot
     captured in PLAN-pipeline.md must still pass.

7. README and exports
   - Export `applyCLAHE` and `CLAHEOptions` from src/index.ts.
   - Add a CLAHE entry to the README API table and a paragraph on the
     pipeline-order constraint.

8. Verify CI chain:
   pnpm typecheck && pnpm lint && prettier --check src && pnpm test:coverage && pnpm build
```

---

## 7. Edge cases to assert explicitly

- `tilesX = 1, tilesY = 1` — degenerates to global histogram equalization;
  must still produce sensible output and not divide by zero.
- `tilesX = width / 4` (smallest legal tile size) — must not crash, output
  must remain in `[0, 1]`.
- Image whose width or height is **exactly** equal to `tilesX` or
  `tilesY` — every tile is 1 pixel wide, which violates the ≥ 4 minimum
  → must throw with a clear message.
- An image where every pixel has the same luminance — histogram has a
  single non-zero bin; CDF is a step function; output must equal input.
- An image with two flat regions of different luminance separated by a
  sharp edge — the bilinear interpolation must produce a smooth
  transition near tile boundaries (test this visually via snapshot).
- Repeated calls (`applyCLAHE(applyCLAHE(x))`) — not the same as a single
  call, but must not crash or produce NaN.

---

## 8. Performance & memory notes

- One allocation: a `Float32Array(tilesX * tilesY * 256)` for the
  histograms-then-CDFs buffer. Default 8×8 grid: 64 KB. Reasonable.
- Two passes over `luminance`: one to build histograms, one to look up
  and interpolate. O(width × height × const) total work.
- The hot inner loop in the interpolation pass should not allocate. Make
  sure no closures are created per pixel. (See donor issue #4.)
- If a future profile shows CLAHE dominating render time on large images,
  the natural next step is **per-tile histogram tiling** (one inner loop
  per tile during the build phase) — but only do that with profiling
  data. Until then: keep it simple.

---

## 9. Decision & Blocker Log

> Append entries here as implementation proceeds. Each entry: ISO date,
> short heading, one paragraph. Use `### Decisions` for choices that
> closed off alternatives, and `### Blockers` for anything that stopped
> progress (a failing test, a missing dependency, an upstream bug, an
> unclear requirement). Do not delete entries — flip them to "Resolved"
> with a follow-up paragraph.

### Decisions

- **2026-04-26 — Single-pass redistribution, not iterative.** The donor
  algorithm and the most common "fast CLAHE" implementations clip each
  bin once and spread the excess uniformly across all 256 bins, which
  can leave some bins above the clip limit afterwards. Strict CLAHE
  iterates until convergence. We chose single-pass for simplicity and
  speed; if a future user reports visible artifacts traceable to this
  choice, revisit.
- **2026-04-26 — In-place mutation.** `applyCLAHE` mutates the input
  Float32Array, matching `applyGamma` and `autoLevels`. An equivalence
  test against a fresh-buffer reference implementation is the safety
  net. Documented in JSDoc.
- **2026-04-26 — Internal `[0, 1]` scale, not `[0, 255]`.** Donor used
  `[0, 255]`; we keep our project-wide `[0, 1]` convention so CLAHE
  composes with `rgbaToLuminance`, `applyGamma`, and `autoLevels`
  without per-step rescaling.
- **2026-04-26 — Skip rotate-in-pipeline rework.** User confirmed input
  images are already in the correct orientation for these workloads.
  Rotate stays as a final 1bpp transform, not part of the
  CLAHE-affecting pipeline order.
- **2026-04-26 — No anchor comment in `src/image.ts` for the future
  rotate-pipeline move.** Considered leaving a `// TODO: when CLAHE
  ships, move rotate above this point` near the rotate call to give
  future-us a starting point. Decision: don't. The plan docs (this
  file §0 and PLAN-pipeline.md §10) own pipeline-ordering rationale;
  production code stays free of narration about hypothetical reworks.
  If the move ever happens, the change author should re-read both
  plan files before touching `image.ts` — that is the documented
  contract, not a comment in the file. Recorded on the CLAHE side
  because that is the plan that would trigger the move.

### Blockers

_No entries yet — append as you implement._

---

## 10. Progress checklist

Mirror this in `progress.md` once work begins.

- [ ] 1. Pre-flight (PLAN-pipeline.md is shipped, donor issues reviewed)
- [ ] 2. Add `CLAHEOptions` and extend `ImageRenderOptions`
- [ ] 3. Reference (oracle) `referenceCLAHE` in test file + snapshot
- [ ] 4. Production `applyCLAHE` in `src/pipeline.ts` + equivalence test
- [ ] 5. Correctness / boundary / numerical-safety tests
- [ ] 6. Wire into `renderImage` + integration tests
- [ ] 7. Export from barrel + README
- [ ] 8. Verify full CI chain locally

---

## Addendum A — Donor function (reference implementation)

**Source:** [`brother_ql-webusb` by Thomas Poinsot](https://github.com/ThomasPoinsot/brother_ql-webusb/blob/master/src/brother-lib/conversion.ts#L279-L344)

This is the verbatim donor function that informed the algorithm in this
plan. It is included here as a reference only — the production version
in `src/pipeline.ts` deviates in three ways called out in §1 of this
plan: (1) clamps the source intensity in the lookup pass, (2) operates
on `[0, 1]` luminance instead of `[0, 255]`, and (3) inlines the
per-pixel CDF lookup to avoid closure allocation.

Do **not** copy this code unmodified into the codebase. Use it as a
correctness oracle — see step 3 of §6 ("Reference (oracle) implementation
in test file"). License terms of the upstream project apply to any
direct reuse; verify before vendoring.

```typescript
function applyCLAHE(
  src: Float32Array,
  width: number,
  height: number,
  limit: number,
  tilesX: number,
  tilesY: number,
): Float32Array {
  const dst = new Float32Array(src.length);
  const tileSizeX = Math.floor(width / tilesX);
  const tileSizeY = Math.floor(height / tilesY);

  const histograms = new Float32Array(tilesX * tilesY * 256);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const histIdx = (ty * tilesX + tx) * 256;
      const startY = ty * tileSizeY;
      const startX = tx * tileSizeX;
      const endY = ty === tilesY - 1 ? height : startY + tileSizeY;
      const endX = tx === tilesX - 1 ? width : startX + tileSizeX;
      const nPixels = (endY - startY) * (endX - startX);
      const clipLimit = Math.max(1, Math.floor((limit * nPixels) / 256));

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const val = Math.floor(Math.max(0, Math.min(255, src[y * width + x])));
          histograms[histIdx + val]++;
        }
      }

      let clipped = 0;
      for (let i = 0; i < 256; i++) {
        if (histograms[histIdx + i] > clipLimit) {
          clipped += histograms[histIdx + i] - clipLimit;
          histograms[histIdx + i] = clipLimit;
        }
      }
      const redist = clipped / 256;
      for (let i = 0; i < 256; i++) histograms[histIdx + i] += redist;

      let sum = 0;
      for (let i = 0; i < 256; i++) {
        sum += histograms[histIdx + i];
        histograms[histIdx + i] = (sum / nPixels) * 255;
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tx = (x - tileSizeX / 2) / tileSizeX;
      const ty = (y - tileSizeY / 2) / tileSizeY;
      const tx1 = Math.floor(tx);
      const ty1 = Math.floor(ty);
      const tx2 = tx1 + 1;
      const ty2 = ty1 + 1;
      const fx = tx - tx1;
      const fy = ty - ty1;
      const v = Math.floor(src[y * width + x]);
      const getCDF = (tpx: number, tpy: number) => {
        const cx = Math.max(0, Math.min(tilesX - 1, tpx));
        const cy = Math.max(0, Math.min(tilesY - 1, tpy));
        return histograms[(cy * tilesX + cx) * 256 + v];
      };
      const c11 = getCDF(tx1, ty1);
      const c21 = getCDF(tx2, ty1);
      const c12 = getCDF(tx1, ty2);
      const c22 = getCDF(tx2, ty2);
      dst[y * width + x] =
        (1 - fy) * ((1 - fx) * c11 + fx * c21) + fy * ((1 - fx) * c12 + fx * c22);
    }
  }
  return dst;
}
```
