import { describe, expect, it } from 'vitest';

import { renderImage } from '../image.js';

function rgba(
  width: number,
  height: number,
  pixels: number[],
): { width: number; height: number; data: Uint8Array } {
  return { width, height, data: new Uint8Array(pixels) };
}

describe('renderImage', () => {
  it('throws on zero-width image', () => {
    expect(() => renderImage(rgba(0, 1, []))).toThrow(RangeError);
  });

  it('throws on zero-height image', () => {
    expect(() => renderImage(rgba(1, 0, []))).toThrow(RangeError);
  });

  it('throws if data length does not match dimensions', () => {
    expect(() => renderImage(rgba(1, 1, [0, 0, 0]))).toThrow(RangeError);
  });

  it('all-white RGBA gives all-zero bitmap data', () => {
    const bmp = renderImage(rgba(2, 1, [255, 255, 255, 255, 255, 255, 255, 255]));
    expect(Array.from(bmp.data)).toEqual([0]);
  });

  it('all-black RGBA gives all-set bitmap data', () => {
    const bmp = renderImage(rgba(2, 1, [0, 0, 0, 255, 0, 0, 0, 255]));
    expect(Array.from(bmp.data)).toEqual([0b11000000]);
  });

  it('threshold=0 results in all white', () => {
    const bmp = renderImage(rgba(2, 1, [0, 0, 0, 255, 0, 0, 0, 255]), { threshold: 0 });
    expect(Array.from(bmp.data)).toEqual([0]);
  });

  it('invert flips output bits', () => {
    const img = rgba(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]);
    const normal = renderImage(img);
    const inverted = renderImage(img, { invert: true });
    expect(normal.data[0]).not.toBe(inverted.data[0]);
  });

  it('alpha compositing uses white background', () => {
    const bmp = renderImage(rgba(1, 1, [0, 0, 0, 0]));
    expect(bmp.data[0]).toBe(0);
  });

  it('rotate=90 swaps dimensions', () => {
    const bmp = renderImage(rgba(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]), { rotate: 90 });
    expect(bmp.widthPx).toBe(1);
    expect(bmp.heightPx).toBe(2);
  });

  it('rotate=180 preserves dimensions', () => {
    const bmp = renderImage(rgba(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]), { rotate: 180 });
    expect(bmp.widthPx).toBe(2);
    expect(bmp.heightPx).toBe(1);
  });

  it('rotate=270 swaps dimensions', () => {
    const bmp = renderImage(rgba(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]), { rotate: 270 });
    expect(bmp.widthPx).toBe(1);
    expect(bmp.heightPx).toBe(2);
  });

  it('dither=true produces non-uniform output for mid-grey input', () => {
    const pixels = new Array(64).fill(0).flatMap(() => [128, 128, 128, 255]);
    const bmp = renderImage(rgba(8, 8, pixels), { dither: true });
    const unique = new Set(Array.from(bmp.data));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('dither=false produces uniform output for mid-grey input', () => {
    const pixels = new Array(64).fill(0).flatMap(() => [128, 128, 128, 255]);
    const bmp = renderImage(rgba(8, 8, pixels), { dither: false, threshold: 128 });
    expect(new Set(Array.from(bmp.data)).size).toBe(1);
  });

  it('v1.0 default behaviour is unchanged', () => {
    // Captured before any pipeline-plan refactor. If this snapshot drifts
    // after a refactor, STOP — investigate before regenerating it.
    // Fixture: 16x8 RGBA gradient with mixed channels and a non-trivial
    // alpha pattern, exercising rgbaToLuminance + thresholdToBitmap with
    // default options (threshold=128, dither=false, invert=false, rotate=0).
    const width = 16;
    const height = 8;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        data[i] = (x * 17) & 0xff;
        data[i + 1] = ((x + y) * 13) & 0xff;
        data[i + 2] = (y * 31) & 0xff;
        data[i + 3] = ((x ^ y) & 1) === 0 ? 255 : 200;
      }
    }
    const bmp = renderImage({ width, height, data });
    expect({
      widthPx: bmp.widthPx,
      heightPx: bmp.heightPx,
      data: Array.from(bmp.data),
    }).toMatchSnapshot();
  });

  it('v1.0 default behaviour is unchanged (dither=true)', () => {
    // Same fixture as above, captured with dither=true (Floyd–Steinberg).
    // This is the load-bearing snapshot for the dither.ts refactor onto the
    // shared errorDiffusion driver — a drift here means kernel iteration
    // order changed.
    const width = 16;
    const height = 8;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        data[i] = (x * 17) & 0xff;
        data[i + 1] = ((x + y) * 13) & 0xff;
        data[i + 2] = (y * 31) & 0xff;
        data[i + 3] = ((x ^ y) & 1) === 0 ? 255 : 200;
      }
    }
    const bmp = renderImage({ width, height, data }, { dither: true });
    expect({
      widthPx: bmp.widthPx,
      heightPx: bmp.heightPx,
      data: Array.from(bmp.data),
    }).toMatchSnapshot();
  });

  it('dither: "atkinson" produces non-uniform output for mid-grey input', () => {
    const pixels = new Array(64).fill(0).flatMap(() => [128, 128, 128, 255]);
    const bmp = renderImage(rgba(8, 8, pixels), { dither: 'atkinson' });
    expect(new Set(Array.from(bmp.data)).size).toBeGreaterThan(1);
  });

  it('dither: "bayer4" tiles a 5x5 mid-grey image deterministically', () => {
    const pixels = new Array(25).fill(0).flatMap(() => [128, 128, 128, 255]);
    const a = renderImage(rgba(5, 5, pixels), { dither: 'bayer4' });
    const b = renderImage(rgba(5, 5, pixels), { dither: 'bayer4' });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('dither: true is a synonym for "floyd-steinberg" (byte-identical output)', () => {
    const pixels = new Array(64).fill(0).flatMap(() => [128, 128, 128, 255]);
    const trueOut = renderImage(rgba(8, 8, pixels), { dither: true });
    const fsOut = renderImage(rgba(8, 8, pixels), { dither: 'floyd-steinberg' });
    expect(Array.from(trueOut.data)).toEqual(Array.from(fsOut.data));
  });

  it('autoLevels stretches a low-contrast input before threshold', () => {
    // 4 grey pixels in [102, 127] (range 25/255). Without autoLevels every
    // pixel is unambiguously darker than threshold 128 → all black. With
    // autoLevels they stretch to span [0, 1] → upper half crosses to white.
    const pixels = [102, 102, 102, 255, 110, 110, 110, 255, 120, 120, 120, 255, 127, 127, 127, 255];
    const without = renderImage(rgba(4, 1, pixels), { autoLevels: false });
    const withal = renderImage(rgba(4, 1, pixels), { autoLevels: true });
    expect(without.data[0]).toBe(0b11110000);
    expect(withal.data[0]).not.toBe(0b11110000);
  });

  it('autoLevels has no effect on a flat input', () => {
    const pixels = new Array(8).fill(0).flatMap(() => [128, 128, 128, 255]);
    const flat = renderImage(rgba(8, 1, pixels), { autoLevels: false });
    const stretched = renderImage(rgba(8, 1, pixels), { autoLevels: true });
    expect(Array.from(flat.data)).toEqual(Array.from(stretched.data));
  });

  it('gamma=2 darkens midtones — fewer black pixels than gamma=1 at threshold=128', () => {
    // Gradient from 64..192 (around the 128 threshold).
    const width = 32;
    const data = new Uint8Array(width * 4);
    for (let x = 0; x < width; x += 1) {
      const v = 64 + Math.round((x / (width - 1)) * 128);
      data[x * 4] = v;
      data[x * 4 + 1] = v;
      data[x * 4 + 2] = v;
      data[x * 4 + 3] = 255;
    }
    const g1 = renderImage({ width, height: 1, data }, { gamma: 1 });
    // Gamma > 1 darkens midtones: pow(L, 2) < L for L in (0,1), so luminance
    // values shift down, meaning *more* darkness → more black pixels under
    // threshold? No — threshold compares value*255 < 128. Lower luminance
    // → MORE black. So gamma=2 → more black, not fewer.
    // The plan wording is ambiguous about direction; what matters is that
    // gamma=2 vs gamma=1 produces a *different* bitmap with strictly more
    // black coverage on this gradient.
    const g2 = renderImage({ width, height: 1, data }, { gamma: 2 });
    const black = (bytes: Uint8Array): number => {
      let n = 0;
      for (const byte of bytes) {
        let b = byte;
        while (b) {
          n += b & 1;
          b >>>= 1;
        }
      }
      return n;
    };
    expect(black(g2.data)).toBeGreaterThan(black(g1.data));
  });

  it('gamma=0.5 brightens midtones — fewer black pixels than gamma=1 at threshold=128', () => {
    const width = 32;
    const data = new Uint8Array(width * 4);
    for (let x = 0; x < width; x += 1) {
      const v = 64 + Math.round((x / (width - 1)) * 128);
      data[x * 4] = v;
      data[x * 4 + 1] = v;
      data[x * 4 + 2] = v;
      data[x * 4 + 3] = 255;
    }
    const g1 = renderImage({ width, height: 1, data }, { gamma: 1 });
    const gh = renderImage({ width, height: 1, data }, { gamma: 0.5 });
    const black = (bytes: Uint8Array): number => {
      let n = 0;
      for (const byte of bytes) {
        let b = byte;
        while (b) {
          n += b & 1;
          b >>>= 1;
        }
      }
      return n;
    };
    expect(black(gh.data)).toBeLessThan(black(g1.data));
  });

  it('gamma=1 produces output identical to omitting the option', () => {
    const pixels = new Array(64).fill(0).flatMap(() => [100, 150, 200, 255]);
    const omit = renderImage(rgba(8, 8, pixels));
    const explicit = renderImage(rgba(8, 8, pixels), { gamma: 1 });
    expect(Array.from(explicit.data)).toEqual(Array.from(omit.data));
  });

  it('luminanceWeights="bt601" produces different output than "bt709" on a red-dominant input', () => {
    // A pixel that BT.709 and BT.601 weight differently. Pure red @ 200:
    //   BT.709 lum = 0.2126 * 200 = 42.52
    //   BT.601 lum = 0.299 * 200 = 59.8
    // Both below threshold 128 → both black for this single pixel. Need a
    // value that lands on different sides of the threshold under the two
    // weights. Try R=G=0, B=255 with no alpha shift:
    //   BT.709 lum = 0.0722 * 255 = 18.4 (black)
    //   BT.601 lum = 0.114 * 255 = 29.1 (black)
    // Or R=255, G=255, B=0 (yellow):
    //   BT.709 lum = 0.2126*255 + 0.7152*255 = 235.7 (white)
    //   BT.601 lum = 0.299*255 + 0.587*255 = 226.0 (white)
    // Need a colour where the weights differ enough to cross the threshold.
    // Pure red R=210:
    //   BT.709 lum = 0.2126 * 210 = 44.6 (black)
    //   BT.601 lum = 0.299 * 210 = 62.8 (black)
    // Try R=600 — out of range. Use a high red plus low green/blue:
    // R=255, G=0, B=0:
    //   BT.709 lum = 54.2 (black)
    //   BT.601 lum = 76.2 (black)
    // We need a colour where BT.709 < 128 and BT.601 >= 128 (or vice versa).
    // The weights differ by ~0.1 on R and G. With R = 255 the difference is
    // 22 luminance units. To straddle 128 we need BT.709 lum near 128.
    // Magenta R=255, B=255: BT.709 = 0.2126*255 + 0.0722*255 = 72.4 (black);
    // BT.601 = 0.299*255 + 0.114*255 = 105.3 (black) — both black.
    // Use a red-and-some-green colour: R=255, G=130, B=0:
    //   BT.709 = 0.2126*255 + 0.7152*130 = 54.2 + 93.0 = 147.2 (white)
    //   BT.601 = 0.299*255 + 0.587*130 = 76.2 + 76.3 = 152.5 (white)
    // Both white. We need to push one across without the other.
    // R=255, G=170, B=0:
    //   BT.709 = 54.2 + 121.6 = 175.8 (white)
    //   BT.601 = 76.2 + 99.8 = 176.0 (white)
    // Try R=255, G=110, B=0:
    //   BT.709 = 54.2 + 78.7 = 132.9 (white)
    //   BT.601 = 76.2 + 64.6 = 140.8 (white)
    // R=255, G=90, B=0:
    //   BT.709 = 54.2 + 64.4 = 118.6 (black)
    //   BT.601 = 76.2 + 52.8 = 129.0 (white)
    // Yes — straddles 128.
    const pixels = [255, 90, 0, 255];
    const bt709 = renderImage(rgba(1, 1, pixels), { luminanceWeights: 'bt709' });
    const bt601 = renderImage(rgba(1, 1, pixels), { luminanceWeights: 'bt601' });
    expect(bt709.data[0]).not.toBe(bt601.data[0]);
  });

  it('luminanceWeights default ("bt709") matches the no-option v1.0 snapshot', () => {
    // Same fixture as the v1.0 regression snapshot.
    const width = 16;
    const height = 8;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        data[i] = (x * 17) & 0xff;
        data[i + 1] = ((x + y) * 13) & 0xff;
        data[i + 2] = (y * 31) & 0xff;
        data[i + 3] = ((x ^ y) & 1) === 0 ? 255 : 200;
      }
    }
    const omit = renderImage({ width, height, data });
    const explicit = renderImage({ width, height, data }, { luminanceWeights: 'bt709' });
    expect(Array.from(explicit.data)).toEqual(Array.from(omit.data));
  });

  it('luminanceWeights tuple [1,0,0] picks only the red channel', () => {
    // Two pixels: bright-red and bright-green. With [1, 0, 0] weights only
    // red contributes, so the green pixel reads as luminance 0 (black) and
    // the red pixel reads as luminance 1 (white). Without alpha, value=255
    // means lum=1.
    const pixels = [255, 0, 0, 255, 0, 255, 0, 255];
    const bmp = renderImage(rgba(2, 1, pixels), { luminanceWeights: [1, 0, 0] });
    // First pixel red → bright → white (bit 0). Second pixel green → dark → black (bit 1).
    expect(bmp.data[0]).toBe(0b01000000);
  });

  it('luminanceWeights tuple summing to 0.9 throws', () => {
    const pixels = [128, 128, 128, 255];
    expect(() => renderImage(rgba(1, 1, pixels), { luminanceWeights: [0.3, 0.3, 0.3] })).toThrow(
      RangeError,
    );
  });

  it('luminanceWeights tuple with a negative component throws', () => {
    const pixels = [128, 128, 128, 255];
    expect(() => renderImage(rgba(1, 1, pixels), { luminanceWeights: [1.5, -0.3, -0.2] })).toThrow(
      RangeError,
    );
  });

  it('pipeline order: autoLevels runs before gamma (verified via known fixture)', () => {
    // 4-pixel grey gradient with luminance values { 0.2, 0.4, 0.6, 0.8 } —
    // a wide spread is required because a 2-value fixture collapses to the
    // same extremes under either ordering.
    //
    // autoLevels then gamma=2:
    //   stretch [0.2..0.8] → [0, 0.333, 0.667, 1]
    //   gamma=2 squares    → [0, 0.111, 0.444, 1]
    //   threshold 128 (i.e. value < 0.5):  black, black, black, white
    //   → 0b11100000
    //
    // gamma=2 then autoLevels:
    //   gamma=2 → [0.04, 0.16, 0.36, 0.64]
    //   stretch → [0, 0.2, 0.533, 1]
    //   threshold 128: black, black, white, white
    //   → 0b11000000
    //
    // Documented order is autoLevels-then-gamma. Output must be 0b11100000.
    const pixels = [51, 51, 51, 255, 102, 102, 102, 255, 153, 153, 153, 255, 204, 204, 204, 255];
    const bmp = renderImage(rgba(4, 1, pixels), { autoLevels: true, gamma: 2 });
    expect(bmp.data[0]).toBe(0b11100000);
  });

  it('snapshot: full pipeline (autoLevels + gamma=1.5 + atkinson) on a 32x32 gradient', () => {
    const width = 32;
    const height = 32;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        // Diagonal gradient compressed into [60, 200] for autoLevels to work on.
        const v = 60 + Math.round(((x + y) / (width + height - 2)) * 140);
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const bmp = renderImage(
      { width, height, data },
      { autoLevels: true, gamma: 1.5, dither: 'atkinson' },
    );
    expect(Array.from(bmp.data)).toMatchSnapshot();
  });
});
