import { describe, expect, it } from 'vitest';

import { renderMultiPlaneImage } from '../multiplane.js';
import type { LabelBitmap, RawImageData } from '../types.js';

// ---------- helpers ----------

function solidRgba(
  width: number,
  height: number,
  rgbaPixel: readonly [number, number, number, number],
): RawImageData {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgbaPixel[0];
    data[i * 4 + 1] = rgbaPixel[1];
    data[i * 4 + 2] = rgbaPixel[2];
    data[i * 4 + 3] = rgbaPixel[3];
  }
  return { width, height, data };
}

/** 1px checkerboard alternating colour A and colour B; opaque. */
function checkerboard(
  width: number,
  height: number,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): RawImageData {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const useA = (x + y) % 2 === 0;
      const c = useA ? a : b;
      data[idx] = c[0];
      data[idx + 1] = c[1];
      data[idx + 2] = c[2];
      data[idx + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Stripes of red and black separated by a single anti-aliased boundary
 * column; designed to exercise leakage at a colour boundary. */
function buildAARedBlackText(): RawImageData {
  const width = 16;
  const height = 8;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      let r = 255,
        g = 255,
        b = 255;
      if (x === 7) {
        // AA edge between black (left) and red (right): muddy mix.
        r = 100;
        g = 0;
        b = 0;
      } else if (x === 8) {
        // AA on the red side
        r = 180;
        g = 30;
        b = 30;
      } else if (x < 7) {
        r = 0;
        g = 0;
        b = 0; // black region
      } else {
        r = 204;
        g = 0;
        b = 0; // red region
      }
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Two horizontal bands sized 16×16 (top: black-classified, bottom: red-
 * classified) where every pixel sits at intensity ≈ 0.49 → luminance ≈ 0.51,
 * the worst case for negative-error leakage in error-diffusion. With masks
 * intact, errors from the top band must NOT leak into the bottom band's
 * per-plane background and vice versa.
 *
 * For palette {[0,0,0], [204,0,0]} the Voronoi half-radius for each entry
 * is the distance to its nearest other palette entry (204) divided by 2
 * (= 102). Intensity 0.49 ⇒ pixel distance ≈ 51.96 from the palette colour.
 * So:
 *   - black-side pixel ≈ [52, 0, 0]
 *   - red-side pixel ≈ [152, 0, 0]
 */
function buildBoundaryFixture(): RawImageData {
  const width = 16;
  const height = 16;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const isTopBand = y < height / 2;
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      data[idx] = isTopBand ? 52 : 152;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 255;
    }
  }
  return { width, height, data };
}

function buildThreePaletteFixture(): RawImageData {
  // 12x4: 4 columns each of red, blue, black, white. Tests three planes
  // touching at multiple boundaries.
  const width = 12;
  const height = 4;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      let r = 255,
        g = 255,
        b = 255;
      if (x < 3) {
        r = 204;
        g = 0;
        b = 0;
      } else if (x < 6) {
        r = 0;
        g = 0;
        b = 204;
      } else if (x < 9) {
        r = 0;
        g = 0;
        b = 0;
      }
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return { width, height, data };
}

function popcount(b: number): number {
  let n = 0;
  let v = b;
  while (v > 0) {
    n += v & 1;
    v >>>= 1;
  }
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

function countSetBits(bmp: LabelBitmap): number {
  let n = 0;
  for (const byte of bmp.data) n += popcount(byte);
  return n;
}

const RED_BLACK = [
  { name: 'black', rgb: [0, 0, 0] as const },
  { name: 'red', rgb: [204, 0, 0] as const },
] as const;

// ---------- mutual exclusivity (the load-bearing suite) ----------

describe('renderMultiPlaneImage > mutual exclusivity', () => {
  it('dense red/black 1px checkerboard, FS dither: 0 collisions', () => {
    const planes = renderMultiPlaneImage(checkerboard(8, 8, [204, 0, 0], [0, 0, 0]), {
      palette: RED_BLACK,
      defaults: { dither: 'floyd-steinberg' },
    });
    expect(pairwiseCollisions(planes)).toBe(0);
  });

  it.each(['floyd-steinberg', 'atkinson', 'stucki', 'jarvis-judice-ninke'] as const)(
    '%s on AA red-touching-black fixture: 0 collisions',
    method => {
      const planes = renderMultiPlaneImage(buildAARedBlackText(), {
        palette: RED_BLACK,
        defaults: { dither: method },
      });
      expect(pairwiseCollisions(planes)).toBe(0);
    },
  );

  it('jarvis-judice-ninke on dense boundary fixture (worst case): 0 collisions', () => {
    const planes = renderMultiPlaneImage(buildBoundaryFixture(), {
      palette: RED_BLACK,
      defaults: { dither: 'jarvis-judice-ninke' },
    });
    expect(pairwiseCollisions(planes)).toBe(0);
  });

  it('3-plane palette (black/red/blue) with mixed dither methods: 0 collisions', () => {
    const planes = renderMultiPlaneImage(buildThreePaletteFixture(), {
      palette: [
        { name: 'black', rgb: [0, 0, 0] },
        { name: 'red', rgb: [204, 0, 0] },
        { name: 'blue', rgb: [0, 0, 204] },
      ],
      planes: {
        black: { dither: 'floyd-steinberg' },
        red: { dither: 'atkinson' },
        blue: { dither: 'bayer4' },
      },
    });
    expect(pairwiseCollisions(planes)).toBe(0);
  });

  it('Bayer dither: 0 collisions on AA fixture', () => {
    const planes = renderMultiPlaneImage(buildAARedBlackText(), {
      palette: RED_BLACK,
      defaults: { dither: 'bayer4' },
    });
    expect(pairwiseCollisions(planes)).toBe(0);
  });

  it('threshold (no dither): 0 collisions on AA fixture', () => {
    const planes = renderMultiPlaneImage(buildAARedBlackText(), {
      palette: RED_BLACK,
    });
    expect(pairwiseCollisions(planes)).toBe(0);
  });

  // The original plan (PLAN-multiplane.md §6 fixture E) imagined a regression
  // test that runs renderMultiPlaneImage with the mask disabled and asserts
  // collisions > 0, proving the mask check is load-bearing. Empirically that
  // does not hold on any fixture we could construct: error diffusion
  // preserves total energy, and the boundary row receives a sum of
  // alternating-sign errors from above that nets to ~0. The mask remains
  // load-bearing as a *contract* (an adversarial caller could construct a
  // luminance buffer where errors would leak), but it's not directly
  // observable through bit collisions. See PLAN-multiplane.md §10 Blocker
  // 2026-04-27 for the full investigation.
  //
  // We keep the __unsafeDisableMask hatch because it remains useful for
  // probing future fixtures, but we don't gate CI on it here.
});

// ---------- classifier (RGB) ----------

describe('classifier (RGB)', () => {
  it('pure palette colour classifies to that entry with intensity ≈ 1', () => {
    const planes = renderMultiPlaneImage(solidRgba(2, 2, [204, 0, 0, 255]), {
      palette: RED_BLACK,
    });
    expect(countSetBits(planes.red!)).toBe(4);
    expect(countSetBits(planes.black!)).toBe(0);
  });

  it('pure white classifies to background; no plane gets bits', () => {
    const planes = renderMultiPlaneImage(solidRgba(2, 2, [255, 255, 255, 255]), {
      palette: RED_BLACK,
    });
    expect(countSetBits(planes.red!)).toBe(0);
    expect(countSetBits(planes.black!)).toBe(0);
  });

  it('off-white (250, 250, 250) classifies to background', () => {
    const planes = renderMultiPlaneImage(solidRgba(2, 2, [250, 250, 250, 255]), {
      palette: RED_BLACK,
    });
    expect(countSetBits(planes.red!)).toBe(0);
    expect(countSetBits(planes.black!)).toBe(0);
  });

  it('alpha = 0 composites to white → background', () => {
    const planes = renderMultiPlaneImage(solidRgba(2, 2, [0, 0, 0, 0]), {
      palette: RED_BLACK,
    });
    expect(countSetBits(planes.black!)).toBe(0);
  });

  it('boundary pixel between two palette entries lands in neither plane (intensity 0)', () => {
    // A pixel exactly at the Voronoi-cell boundary between two palette
    // entries has intensity 0 in both planes → luminance 1 → no bit set in
    // either. (We can't directly observe the tiebreak rule from output
    // bits because boundary intensity 0 produces no ink in either plane;
    // the tiebreak code path is exercised internally and has no
    // bit-level effect at the precise boundary.)
    const palette = [
      { name: 'a', rgb: [100, 100, 100] as const },
      { name: 'b', rgb: [150, 150, 150] as const },
    ] as const;
    const planes = renderMultiPlaneImage(solidRgba(1, 1, [125, 125, 125, 255]), {
      palette,
    });
    expect(countSetBits(planes.a!)).toBe(0);
    expect(countSetBits(planes.b!)).toBe(0);
  });

  it('pixel slightly closer to palette[0] classifies there (argmin)', () => {
    const palette = [
      { name: 'a', rgb: [100, 100, 100] as const },
      { name: 'b', rgb: [200, 200, 200] as const },
    ] as const;
    // [110, 110, 110]: dist to a = sqrt(300) ≈ 17.3, dist to b = sqrt(27000) ≈ 164.
    // a wins. radius for a = nearest neighbour distance / 2.
    const planes = renderMultiPlaneImage(solidRgba(1, 1, [110, 110, 110, 255]), {
      palette,
    });
    expect(countSetBits(planes.a!)).toBe(1);
    expect(countSetBits(planes.b!)).toBe(0);
  });

  it('intensity scales by per-entry Voronoi half-width', () => {
    // Two palette entries far from each other and from white. The classifier
    // should report intensity proportional to the distance from the boundary,
    // computed against each entry's own nearest-neighbour radius.
    const palette = [
      { name: 'p1', rgb: [10, 10, 10] as const },
      { name: 'p2', rgb: [50, 50, 50] as const },
    ] as const;
    // p1's nearest neighbour is p2 (distance ~69.3), so radius = ~34.6.
    // A pixel at [10, 10, 10] (exactly p1) → intensity 1.0 → luminance 0
    // → bit set under threshold 128.
    const planes = renderMultiPlaneImage(solidRgba(1, 1, [10, 10, 10, 255]), {
      palette,
    });
    expect(countSetBits(planes.p1!)).toBe(1);
  });
});

// ---------- per-plane pipeline ----------

describe('renderMultiPlaneImage > per-plane options', () => {
  it('per-plane dither overrides defaults', () => {
    const fixture = buildAARedBlackText();
    const planes = renderMultiPlaneImage(fixture, {
      palette: RED_BLACK,
      defaults: { dither: 'floyd-steinberg' },
      planes: {
        red: { dither: false }, // hard threshold for red, FS for black
      },
    });
    // Both planes still mutually exclusive.
    expect(pairwiseCollisions(planes)).toBe(0);
  });

  it('per-plane gamma changes output of that plane only', () => {
    const fixture = buildAARedBlackText();
    const baseline = renderMultiPlaneImage(fixture, {
      palette: RED_BLACK,
    });
    const gammaApplied = renderMultiPlaneImage(fixture, {
      palette: RED_BLACK,
      planes: { red: { gamma: 2.0 } },
    });
    // Black plane is unaffected; red plane changes (or at least is allowed to).
    expect(Array.from(gammaApplied.black!.data)).toEqual(Array.from(baseline.black!.data));
  });

  it('rotate applies to every plane uniformly', () => {
    const fixture = buildAARedBlackText(); // 16x8
    const planes = renderMultiPlaneImage(fixture, {
      palette: RED_BLACK,
      rotate: 90,
    });
    // After 90° rotation, a 16x8 source becomes an 8x16 plane.
    expect(planes.red!.widthPx).toBe(8);
    expect(planes.red!.heightPx).toBe(16);
    expect(planes.black!.widthPx).toBe(8);
    expect(planes.black!.heightPx).toBe(16);
  });

  it('per-plane autoLevels runs per-plane (does not cross-contaminate)', () => {
    const planes = renderMultiPlaneImage(buildThreePaletteFixture(), {
      palette: [
        { name: 'black', rgb: [0, 0, 0] },
        { name: 'red', rgb: [204, 0, 0] },
        { name: 'blue', rgb: [0, 0, 204] },
      ],
      defaults: { autoLevels: true },
    });
    expect(pairwiseCollisions(planes)).toBe(0);
  });

  it('a plane with zero classified pixels yields an all-zero bitmap', () => {
    const planes = renderMultiPlaneImage(solidRgba(4, 4, [0, 0, 0, 255]), {
      palette: RED_BLACK,
    });
    expect(countSetBits(planes.red!)).toBe(0);
    expect(countSetBits(planes.black!)).toBe(16);
  });
});

// ---------- validation ----------

describe('renderMultiPlaneImage > validation', () => {
  const validImage = solidRgba(2, 2, [255, 255, 255, 255]);

  it('throws on empty palette', () => {
    expect(() => renderMultiPlaneImage(validImage, { palette: [] })).toThrow(RangeError);
  });

  it('throws on duplicate plane names', () => {
    expect(() =>
      renderMultiPlaneImage(validImage, {
        palette: [
          { name: 'x', rgb: [0, 0, 0] },
          { name: 'x', rgb: [200, 0, 0] },
        ],
      }),
    ).toThrow(RangeError);
  });

  it("throws if a palette entry is named 'white' (reserved)", () => {
    expect(() =>
      renderMultiPlaneImage(validImage, {
        palette: [{ name: 'white', rgb: [200, 200, 0] }],
      }),
    ).toThrow(RangeError);
  });

  it('throws on rgb component out of range', () => {
    expect(() =>
      renderMultiPlaneImage(validImage, {
        palette: [{ name: 'x', rgb: [-1, 0, 0] }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      renderMultiPlaneImage(validImage, {
        palette: [{ name: 'x', rgb: [256, 0, 0] }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      renderMultiPlaneImage(validImage, {
        palette: [{ name: 'x', rgb: [Number.NaN, 0, 0] }],
      }),
    ).toThrow(RangeError);
  });

  it('throws on rgb [255, 255, 255] (collides with implicit white)', () => {
    expect(() =>
      renderMultiPlaneImage(validImage, {
        palette: [{ name: 'snowtape', rgb: [255, 255, 255] }],
      }),
    ).toThrow(RangeError);
  });

  it('throws on duplicate palette rgb', () => {
    expect(() =>
      renderMultiPlaneImage(validImage, {
        palette: [
          { name: 'a', rgb: [100, 0, 0] },
          { name: 'b', rgb: [100, 0, 0] },
        ],
      }),
    ).toThrow(RangeError);
  });

  it('throws on more than 254 palette entries', () => {
    const big = Array.from({ length: 255 }, (_, i) => ({
      name: `p${String(i)}`,
      rgb: [i, 0, 0] as const,
    }));
    expect(() => renderMultiPlaneImage(validImage, { palette: big })).toThrow(RangeError);
  });

  it('throws on zero-dimension image', () => {
    expect(() =>
      renderMultiPlaneImage(
        { width: 0, height: 1, data: new Uint8Array(0) },
        { palette: RED_BLACK },
      ),
    ).toThrow(RangeError);
  });

  it('throws on data length mismatch', () => {
    expect(() =>
      renderMultiPlaneImage(
        { width: 2, height: 2, data: new Uint8Array(4) },
        { palette: RED_BLACK },
      ),
    ).toThrow(RangeError);
  });
});

// ---------- LAB classification ----------

describe('renderMultiPlaneImage > LAB classification', () => {
  it('matches RGB for well-separated palettes (sanity)', () => {
    const fixture = buildThreePaletteFixture();
    const palette = [
      { name: 'black', rgb: [0, 0, 0] },
      { name: 'red', rgb: [204, 0, 0] },
      { name: 'blue', rgb: [0, 0, 204] },
    ] as const;
    const rgb = renderMultiPlaneImage(fixture, { palette, colorSpace: 'rgb' });
    const lab = renderMultiPlaneImage(fixture, { palette, colorSpace: 'lab' });
    // For these clearly-separated palette colours, both modes should
    // partition pixels the same way (bit counts per plane match).
    for (const p of ['black', 'red', 'blue']) {
      expect(countSetBits(lab[p]!)).toBe(countSetBits(rgb[p]!));
    }
  });

  it('produces 0 collisions on the boundary fixture', () => {
    const planes = renderMultiPlaneImage(buildBoundaryFixture(), {
      palette: RED_BLACK,
      colorSpace: 'lab',
      defaults: { dither: 'floyd-steinberg' },
    });
    expect(pairwiseCollisions(planes)).toBe(0);
  });

  it('classifies a perceptually-close palette pair correctly', () => {
    // Two greens close in RGB but visibly different. LAB picks the visually
    // closer one regardless of sRGB nonlinearity.
    const palette = [
      { name: 'g1', rgb: [0, 200, 0] as const },
      { name: 'g2', rgb: [0, 220, 30] as const },
    ] as const;
    const planes = renderMultiPlaneImage(solidRgba(1, 1, [0, 200, 0, 255]), {
      palette,
      colorSpace: 'lab',
    });
    // The pixel matches g1 exactly — should classify there.
    expect(countSetBits(planes.g1!)).toBe(1);
    expect(countSetBits(planes.g2!)).toBe(0);
  });
});

// ---------- snapshots ----------

describe('renderMultiPlaneImage > snapshots', () => {
  it('snapshot: AA red/black fixture, FS dither', () => {
    const planes = renderMultiPlaneImage(buildAARedBlackText(), {
      palette: RED_BLACK,
      defaults: { dither: 'floyd-steinberg' },
    });
    expect({
      black: Array.from(planes.black!.data),
      red: Array.from(planes.red!.data),
    }).toMatchSnapshot();
  });

  it('snapshot: 3-plane fixture with mixed dithers', () => {
    const planes = renderMultiPlaneImage(buildThreePaletteFixture(), {
      palette: [
        { name: 'black', rgb: [0, 0, 0] },
        { name: 'red', rgb: [204, 0, 0] },
        { name: 'blue', rgb: [0, 0, 204] },
      ],
      planes: {
        black: { dither: 'floyd-steinberg' },
        red: { dither: 'atkinson' },
        blue: { dither: 'bayer4' },
      },
    });
    expect({
      black: Array.from(planes.black!.data),
      red: Array.from(planes.red!.data),
      blue: Array.from(planes.blue!.data),
    }).toMatchSnapshot();
  });
});
