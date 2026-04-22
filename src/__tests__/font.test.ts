import { describe, expect, it } from 'vitest';

import { renderText, measureText } from '../font/render.js';

function trailingMask(widthPx: number): number {
  const bits = widthPx % 8;
  return bits === 0 ? 0xff : ((0xff << (8 - bits)) & 0xff);
}

describe('renderText', () => {
  it('throws on empty string', () => {
    expect(() => renderText('')).toThrow(RangeError);
  });

  it('throws if scaleX is not a positive integer', () => {
    expect(() => renderText('A', { scaleX: 0 })).toThrow(RangeError);
  });

  it('throws if scaleY is not a positive integer', () => {
    expect(() => renderText('A', { scaleY: 0 })).toThrow(RangeError);
  });

  it('produces correct dimensions for a single character at scale 1', () => {
    const bmp = renderText('A');
    expect(bmp.widthPx).toBe(8);
    expect(bmp.heightPx).toBe(8);
  });

  it('produces correct dimensions for multiple characters at scale 1', () => {
    const bmp = renderText('AB');
    expect(bmp.widthPx).toBe(17);
    expect(bmp.heightPx).toBe(8);
  });

  it('produces correct dimensions with scaleX=2, scaleY=3', () => {
    const bmp = renderText('AB', { scaleX: 2, scaleY: 3 });
    expect(bmp.widthPx).toBe(34);
    expect(bmp.heightPx).toBe(24);
  });

  it('produces correct dimensions with letterSpacing=0', () => {
    expect(renderText('AB', { letterSpacing: 0 }).widthPx).toBe(16);
  });

  it('produces correct dimensions with letterSpacing=2', () => {
    expect(renderText('AB', { letterSpacing: 2 }).widthPx).toBe(18);
  });

  it('replaces out-of-range characters with space', () => {
    expect(renderText('\u{1f600}')).toEqual(renderText(' '));
  });

  it('data length matches heightPx * ceil(widthPx / 8)', () => {
    const bmp = renderText('HELLO');
    expect(bmp.data.length).toBe(bmp.heightPx * Math.ceil(bmp.widthPx / 8));
  });

  it('trailing bits in last byte of each row are zero', () => {
    const bmp = renderText('AB');
    const rowBytes = Math.ceil(bmp.widthPx / 8);
    const mask = trailingMask(bmp.widthPx);
    for (let y = 0; y < bmp.heightPx; y += 1) {
      const idx = y * rowBytes + rowBytes - 1;
      expect(bmp.data[idx] & ~mask).toBe(0);
    }
  });

  it('invert: space character becomes all-black', () => {
    const bmp = renderText(' ', { invert: true });
    expect(Array.from(bmp.data)).toEqual(new Array(8).fill(0xff));
  });

  it('invert: A differs from non-inverted output', () => {
    const normal = renderText('A');
    const inverted = renderText('A', { invert: true });
    expect(inverted).not.toEqual(normal);
  });

  it('snapshot: HELLO at scale 1 matches known byte output', () => {
    expect(Array.from(renderText('HELLO').data)).toMatchSnapshot();
  });

  it('snapshot: HELLO at scale 2 matches known byte output', () => {
    expect(Array.from(renderText('HELLO', { scaleX: 2, scaleY: 2 }).data)).toMatchSnapshot();
  });

  it('snapshot: A inverted matches known byte output', () => {
    expect(Array.from(renderText('A', { invert: true }).data)).toMatchSnapshot();
  });
});

describe('measureText', () => {
  it('returns same dimensions as renderText without allocating', () => {
    expect(measureText('HELLO')).toEqual({
      widthPx: renderText('HELLO').widthPx,
      heightPx: renderText('HELLO').heightPx,
    });
  });

  it('handles empty string without throwing', () => {
    expect(measureText('')).toEqual({ widthPx: 0, heightPx: 8 });
  });

  it('respects scaleX, scaleY, letterSpacing', () => {
    expect(measureText('AB', { scaleX: 2, scaleY: 3, letterSpacing: 2 })).toEqual({
      widthPx: 36,
      heightPx: 24,
    });
  });
});
