import { describe, expect, it } from 'vitest';

import { bitmapEquals, createBitmap, getRow, iterRows } from '../encode.js';
import type { LabelBitmap } from '../types.js';

function createSampleBitmap(): LabelBitmap {
  return {
    widthPx: 10,
    heightPx: 2,
    data: new Uint8Array([0xaa, 0xc0, 0x55, 0x40]),
  };
}

describe('getRow', () => {
  it('throws if row is out of bounds', () => {
    const bitmap = createSampleBitmap();
    expect(() => getRow(bitmap, -1)).toThrow(RangeError);
    expect(() => getRow(bitmap, 2)).toThrow(RangeError);
  });

  it('returns correct bytes for row 0', () => {
    expect(getRow(createSampleBitmap(), 0)).toEqual(new Uint8Array([0xaa, 0xc0]));
  });

  it('returns correct bytes for last row', () => {
    expect(getRow(createSampleBitmap(), 1)).toEqual(new Uint8Array([0x55, 0x40]));
  });

  it('returned array is a copy', () => {
    const bitmap = createSampleBitmap();
    const row = getRow(bitmap, 0);
    row[0] = 0x00;
    expect(bitmap.data[0]).toBe(0xaa);
  });

  it('length equals ceil(widthPx / 8)', () => {
    expect(getRow(createSampleBitmap(), 0)).toHaveLength(2);
  });
});

describe('iterRows', () => {
  it('yields heightPx rows', () => {
    expect(Array.from(iterRows(createSampleBitmap()))).toHaveLength(2);
  });

  it('each yielded row has ceil(widthPx / 8) bytes', () => {
    const rows = Array.from(iterRows(createSampleBitmap()));
    expect(rows[0]).toHaveLength(2);
    expect(rows[1]).toHaveLength(2);
  });

  it('rows are in top-to-bottom order', () => {
    const rows = Array.from(iterRows(createSampleBitmap()));
    expect(rows[0]).toEqual(new Uint8Array([0xaa, 0xc0]));
    expect(rows[1]).toEqual(new Uint8Array([0x55, 0x40]));
  });
});

describe('createBitmap', () => {
  it('throws if widthPx < 1', () => {
    expect(() => createBitmap(0, 1)).toThrow(RangeError);
  });

  it('throws if heightPx < 1', () => {
    expect(() => createBitmap(1, 0)).toThrow(RangeError);
  });

  it('all bytes are zero', () => {
    expect(Array.from(createBitmap(9, 2).data)).toEqual([0, 0, 0, 0]);
  });

  it('data length is correct', () => {
    expect(createBitmap(9, 3).data).toHaveLength(6);
  });
});

describe('bitmapEquals', () => {
  it('same bitmap returns true', () => {
    const bitmap = createSampleBitmap();
    expect(bitmapEquals(bitmap, bitmap)).toBe(true);
  });

  it('different width returns false', () => {
    expect(bitmapEquals(createBitmap(8, 1), createBitmap(9, 1))).toBe(false);
  });

  it('different height returns false', () => {
    expect(bitmapEquals(createBitmap(8, 1), createBitmap(8, 2))).toBe(false);
  });

  it('same dimensions different data returns false', () => {
    const a = createBitmap(8, 1);
    const b = createBitmap(8, 1);
    b.data[0] = 0xff;
    expect(bitmapEquals(a, b)).toBe(false);
  });

  it('two empty bitmaps of same size return true', () => {
    expect(bitmapEquals(createBitmap(8, 2), createBitmap(8, 2))).toBe(true);
  });
});
