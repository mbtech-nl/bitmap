import { describe, expect, it } from 'vitest';

import { createBitmap } from '../encode.js';
import {
  cropBitmap,
  flipHorizontal,
  flipVertical,
  getPixel,
  invertBitmap,
  padBitmap,
  rotateBitmap,
  scaleBitmap,
  stackBitmaps,
} from '../transform.js';

function fromRows(rows: string[]): ReturnType<typeof createBitmap> {
  const h = rows.length;
  const w = rows[0]!.length;
  const bmp = createBitmap(w, h);
  const rowBytes = Math.ceil(w / 8);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (rows[y]![x] === '#') {
        const idx = y * rowBytes + Math.floor(x / 8);
        bmp.data[idx] |= 1 << (7 - (x % 8));
      }
    }
  }
  return bmp;
}

describe('rotateBitmap', () => {
  const source = fromRows(['#..', '.#.', '..#', '###']);
  it('90° swaps dimensions', () => expect(rotateBitmap(source, 90)).toMatchObject({ widthPx: 4, heightPx: 3 }));
  it('180° preserves dimensions', () => expect(rotateBitmap(source, 180)).toMatchObject({ widthPx: 3, heightPx: 4 }));
  it('270° swaps dimensions', () => expect(rotateBitmap(source, 270)).toMatchObject({ widthPx: 4, heightPx: 3 }));
  it('90° then 270° returns original', () => expect(rotateBitmap(rotateBitmap(source, 90), 270)).toEqual(source));
  it('180° then 180° returns original', () => expect(rotateBitmap(rotateBitmap(source, 180), 180)).toEqual(source));
});

describe('flipHorizontal / flipVertical', () => {
  const src = fromRows(['#..', '.##']);
  it('horizontal mirrors x axis', () => expect(getPixel(flipHorizontal(src), 2, 0)).toBe(true));
  it('vertical mirrors y axis', () => expect(getPixel(flipVertical(src), 0, 1)).toBe(true));
  it('flip twice returns original', () => expect(flipHorizontal(flipHorizontal(src))).toEqual(src));
  it('dimensions preserved', () => expect(flipVertical(src)).toMatchObject({ widthPx: 3, heightPx: 2 }));
});

describe('invertBitmap', () => {
  it('all-zero -> all-set within width', () => {
    const out = invertBitmap(createBitmap(5, 1));
    expect(out.data[0]).toBe(0b11111000);
  });
  it('invert twice returns original', () => {
    const src = fromRows(['#.#..']);
    expect(invertBitmap(invertBitmap(src))).toEqual(src);
  });
});

describe('scaleBitmap', () => {
  const src = fromRows(['#.#.', '.#..']);
  it('throws if targetHeight invalid', () => expect(() => scaleBitmap(src, 0)).toThrow(RangeError));
  it('same height returns equivalent bitmap', () => expect(scaleBitmap(src, 2)).toEqual(src));
  it('double height doubles height', () => expect(scaleBitmap(src, 4).heightPx).toBe(4));
});

describe('cropBitmap', () => {
  const src = fromRows(['##..', '.##.', '..##']);
  it('throws if x is negative', () => expect(() => cropBitmap(src, -1, 0, 1, 1)).toThrow(RangeError));
  it('throws if y is negative', () => expect(() => cropBitmap(src, 0, -1, 1, 1)).toThrow(RangeError));
  it('throws if crop exceeds width', () => expect(() => cropBitmap(src, 3, 0, 2, 1)).toThrow(RangeError));
  it('throws if crop exceeds height', () => expect(() => cropBitmap(src, 0, 2, 1, 2)).toThrow(RangeError));
  it('full-size crop returns equivalent bitmap', () => expect(cropBitmap(src, 0, 0, 4, 3)).toEqual(src));
});

describe('stackBitmaps', () => {
  const a = fromRows(['#.', '.#']);
  const b = fromRows(['##', '..']);
  it('throws on empty array', () => expect(() => stackBitmaps([], 'horizontal')).toThrow(RangeError));
  it('horizontal: totalWidth equals sum', () => expect(stackBitmaps([a, b], 'horizontal').widthPx).toBe(4));
  it('vertical: totalHeight equals sum', () => expect(stackBitmaps([a, b], 'vertical').heightPx).toBe(4));
});

describe('padBitmap', () => {
  const src = fromRows(['#']);
  it('zero padding returns equivalent bitmap', () => expect(padBitmap(src, {})).toEqual(src));
  it('dimensions increased correctly', () => {
    expect(padBitmap(src, { top: 1, right: 2, bottom: 3, left: 4 })).toMatchObject({ widthPx: 7, heightPx: 5 });
  });
  it('padded area is white', () => {
    const out = padBitmap(src, { top: 1, left: 1 });
    expect(getPixel(out, 0, 0)).toBe(false);
    expect(getPixel(out, 1, 1)).toBe(true);
  });
});
