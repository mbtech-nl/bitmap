import type { BuiltinFont, FontMetrics, LabelBitmap, TextRenderOptions } from '../types.js';
import { FONT_8X8, FONT_8X8_METRICS } from './font8x8.js';

const FONTS = {
  default8x8: { data: FONT_8X8, metrics: FONT_8X8_METRICS },
} satisfies Record<BuiltinFont, { data: Uint8Array; metrics: FontMetrics }>;

function assertScale(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function assertSpacing(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError('letterSpacing must be a non-negative integer');
  }
}

function maskTrailingBits(data: Uint8Array, widthPx: number, heightPx: number): void {
  const trailingBits = widthPx % 8;
  if (trailingBits === 0) {
    return;
  }
  const rowBytes = Math.ceil(widthPx / 8);
  const mask = (0xff << (8 - trailingBits)) & 0xff;
  for (let y = 0; y < heightPx; y += 1) {
    const idx = y * rowBytes + rowBytes - 1;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    data[idx]! &= mask;
  }
}

export function renderText(text: string, options: TextRenderOptions = {}): LabelBitmap {
  if (text.length === 0) {
    throw new RangeError('text must not be empty');
  }

  const {
    font = 'default8x8',
    scaleX = 1,
    scaleY = 1,
    letterSpacing = 1,
    invert = false,
  } = options;
  assertScale('scaleX', scaleX);
  assertScale('scaleY', scaleY);
  assertSpacing(letterSpacing);

  const { data: fontData, metrics } = FONTS[font];
  const chars = Array.from(text).map(c => {
    const code = c.codePointAt(0) ?? 32;
    return code >= 32 && code <= 127 ? code : 32;
  });

  const baseWidth = chars.length * metrics.charWidth + (chars.length - 1) * letterSpacing;
  const widthPx = baseWidth * scaleX;
  const heightPx = metrics.charHeight * scaleY;
  const rowBytes = Math.ceil(widthPx / 8);
  const data = new Uint8Array(heightPx * rowBytes);

  for (let charIndex = 0; charIndex < chars.length; charIndex += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const charCode = chars[charIndex]!;
    const glyphOffset = (charCode - 32) * metrics.charHeight;
    const charX = charIndex * (metrics.charWidth + letterSpacing);

    for (let row = 0; row < metrics.charHeight; row += 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const glyphRow = fontData[glyphOffset + row]!;
      for (let col = 0; col < metrics.charWidth; col += 1) {
        // font8x8 stores row bits least-significant-bit first (left-to-right)
        const on = (glyphRow >> col) & 1;
        if (on === 0) {
          continue;
        }
        for (let sy = 0; sy < scaleY; sy += 1) {
          for (let sx = 0; sx < scaleX; sx += 1) {
            const x = (charX + col) * scaleX + sx;
            const y = row * scaleY + sy;
            const idx = y * rowBytes + Math.floor(x / 8);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            data[idx]! |= 1 << (7 - (x % 8));
          }
        }
      }
    }
  }

  if (invert) {
    for (let i = 0; i < data.length; i += 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      data[i] = ~data[i]! & 0xff;
    }
    maskTrailingBits(data, widthPx, heightPx);
  }

  return { widthPx, heightPx, data };
}

export function measureText(
  text: string,
  options: TextRenderOptions = {},
): { widthPx: number; heightPx: number } {
  const { font = 'default8x8', scaleX = 1, scaleY = 1, letterSpacing = 1 } = options;
  assertScale('scaleX', scaleX);
  assertScale('scaleY', scaleY);
  assertSpacing(letterSpacing);
  const { metrics } = FONTS[font];
  const baseWidth =
    text.length === 0 ? 0 : text.length * metrics.charWidth + (text.length - 1) * letterSpacing;
  return { widthPx: baseWidth * scaleX, heightPx: metrics.charHeight * scaleY };
}
