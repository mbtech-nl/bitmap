import type { LabelBitmap } from './types.js';

/**
 * Read a single pixel from a packed 1bpp bitmap.
 *
 * @param bitmap - Source bitmap.
 * @param x - Column (0-indexed, left-to-right).
 * @param y - Row (0-indexed, top-to-bottom).
 * @returns `true` if the pixel is black (bit set), `false` if white.
 *
 * @example
 * ```ts
 * const isBlack = getPixel(bitmap, 0, 0);
 * ```
 */
export function getPixel(bitmap: LabelBitmap, x: number, y: number): boolean {
  const rowBytes = Math.ceil(bitmap.widthPx / 8);
  const byteIdx = y * rowBytes + Math.floor(x / 8);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return ((bitmap.data[byteIdx]! >> (7 - (x % 8))) & 1) === 1;
}

function setPixel(data: Uint8Array, rowBytes: number, x: number, y: number, black: boolean): void {
  const byteIdx = y * rowBytes + Math.floor(x / 8);
  const bit = 1 << (7 - (x % 8));
  if (black) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    data[byteIdx]! |= bit;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    data[byteIdx]! &= ~bit;
  }
}

/**
 * Rotate a bitmap clockwise by 90, 180, or 270 degrees.
 *
 * For 90 and 270 the output dimensions are swapped (`widthPx` and `heightPx`
 * exchange). For 180 the dimensions are unchanged.
 *
 * @param bitmap - Source bitmap.
 * @param degrees - Rotation amount; `90`, `180`, or `270`.
 * @returns A new bitmap; the input is not mutated.
 *
 * @example
 * ```ts
 * const portrait = rotateBitmap(landscape, 90);
 * ```
 */
export function rotateBitmap(bitmap: LabelBitmap, degrees: 90 | 180 | 270): LabelBitmap {
  const { widthPx: w, heightPx: h } = bitmap;
  if (degrees === 180) {
    const rowBytes = Math.ceil(w / 8);
    const data = new Uint8Array(h * rowBytes);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        setPixel(data, rowBytes, w - 1 - x, h - 1 - y, getPixel(bitmap, x, y));
      }
    }
    return { widthPx: w, heightPx: h, data };
  }

  const newW = h;
  const newH = w;
  const rowBytes = Math.ceil(newW / 8);
  const data = new Uint8Array(newH * rowBytes);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const black = getPixel(bitmap, x, y);
      if (degrees === 90) {
        setPixel(data, rowBytes, h - 1 - y, x, black);
      } else {
        setPixel(data, rowBytes, y, w - 1 - x, black);
      }
    }
  }
  return { widthPx: newW, heightPx: newH, data };
}

/**
 * Mirror a bitmap left-to-right.
 *
 * @returns A new bitmap with each row's pixels reversed.
 *
 * @example
 * ```ts
 * const mirrored = flipHorizontal(bitmap);
 * ```
 */
export function flipHorizontal(bitmap: LabelBitmap): LabelBitmap {
  const { widthPx: w, heightPx: h } = bitmap;
  const rowBytes = Math.ceil(w / 8);
  const data = new Uint8Array(h * rowBytes);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      setPixel(data, rowBytes, w - 1 - x, y, getPixel(bitmap, x, y));
    }
  }
  return { widthPx: w, heightPx: h, data };
}

/**
 * Mirror a bitmap top-to-bottom.
 *
 * @returns A new bitmap with rows reversed.
 *
 * @example
 * ```ts
 * const mirrored = flipVertical(bitmap);
 * ```
 */
export function flipVertical(bitmap: LabelBitmap): LabelBitmap {
  const { widthPx: w, heightPx: h } = bitmap;
  const rowBytes = Math.ceil(w / 8);
  const data = new Uint8Array(h * rowBytes);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      setPixel(data, rowBytes, x, h - 1 - y, getPixel(bitmap, x, y));
    }
  }
  return { widthPx: w, heightPx: h, data };
}

/**
 * Swap black and white pixels.
 *
 * Trailing bits in the last byte of each row stay zero (preserves the
 * `LabelBitmap` invariant that unused bits are always 0).
 *
 * @returns A new bitmap with every bit flipped, except trailing padding bits.
 *
 * @example
 * ```ts
 * const negative = invertBitmap(positive);
 * ```
 */
export function invertBitmap(bitmap: LabelBitmap): LabelBitmap {
  const { widthPx, heightPx } = bitmap;
  const rowBytes = Math.ceil(widthPx / 8);
  const data = new Uint8Array(bitmap.data);
  const trailingBits = widthPx % 8;
  const mask = trailingBits === 0 ? 0xff : (0xff << (8 - trailingBits)) & 0xff;
  for (let y = 0; y < heightPx; y += 1) {
    for (let b = 0; b < rowBytes; b += 1) {
      const idx = y * rowBytes + b;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      data[idx] = ~data[idx]! & (b === rowBytes - 1 ? mask : 0xff);
    }
  }
  return { widthPx, heightPx, data };
}

/**
 * Resize a bitmap to a target height while preserving aspect ratio.
 *
 * Uses nearest-neighbour sampling — appropriate for 1bpp output where any
 * smoothing would muddy the result. For pre-rasterisation resizing, scale
 * the source RGBA image instead and pass the result to {@link renderImage}.
 *
 * @param bitmap - Source bitmap.
 * @param targetHeight - Desired height in pixels (positive integer).
 * @returns A new bitmap. Width is computed as `round(srcW * targetHeight / srcH)`,
 *   floored to a minimum of 1.
 * @throws {RangeError} If `targetHeight` is not a positive integer.
 *
 * @example
 * ```ts
 * const fitted = scaleBitmap(logo, 64);
 * ```
 */
export function scaleBitmap(bitmap: LabelBitmap, targetHeight: number): LabelBitmap {
  if (!Number.isInteger(targetHeight) || targetHeight < 1) {
    throw new RangeError('targetHeight must be a positive integer');
  }
  const srcW = bitmap.widthPx;
  const srcH = bitmap.heightPx;
  const targetWidth = Math.max(1, Math.round(srcW * (targetHeight / srcH)));
  const rowBytes = Math.ceil(targetWidth / 8);
  const data = new Uint8Array(targetHeight * rowBytes);
  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.floor((y * srcH) / targetHeight);
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.floor((x * srcW) / targetWidth);
      setPixel(data, rowBytes, x, y, getPixel(bitmap, srcX, srcY));
    }
  }
  return { widthPx: targetWidth, heightPx: targetHeight, data };
}

/**
 * Extract a rectangular sub-region from a bitmap.
 *
 * @param bitmap - Source bitmap.
 * @param x - Left edge of crop, in pixels.
 * @param y - Top edge of crop, in pixels.
 * @param widthPx - Crop width in pixels (≥ 1).
 * @param heightPx - Crop height in pixels (≥ 1).
 * @returns A new bitmap containing the cropped region.
 * @throws {RangeError} If the region is out of bounds or has non-positive dimensions.
 *
 * @example
 * ```ts
 * const header = cropBitmap(label, 0, 0, label.widthPx, 32);
 * ```
 */
export function cropBitmap(
  bitmap: LabelBitmap,
  x: number,
  y: number,
  widthPx: number,
  heightPx: number,
): LabelBitmap {
  if (x < 0 || y < 0) throw new RangeError('x and y must be non-negative');
  if (widthPx < 1 || heightPx < 1) throw new RangeError('widthPx and heightPx must be positive');
  if (x + widthPx > bitmap.widthPx || y + heightPx > bitmap.heightPx) {
    throw new RangeError('crop region out of bounds');
  }
  const rowBytes = Math.ceil(widthPx / 8);
  const data = new Uint8Array(heightPx * rowBytes);
  for (let cy = 0; cy < heightPx; cy += 1) {
    for (let cx = 0; cx < widthPx; cx += 1) {
      setPixel(data, rowBytes, cx, cy, getPixel(bitmap, x + cx, y + cy));
    }
  }
  return { widthPx, heightPx, data };
}

/**
 * Concatenate bitmaps horizontally or vertically.
 *
 * Horizontal stacking requires every input to share the same `heightPx`;
 * vertical stacking requires every input to share the same `widthPx`.
 *
 * @param bitmaps - At least one bitmap to stack.
 * @param direction - `'horizontal'` (left-to-right) or `'vertical'` (top-to-bottom).
 * @returns A new bitmap containing the stacked input.
 * @throws {RangeError} If the input is empty or dimensions don't align.
 *
 * @example
 * ```ts
 * const labelTop = stackBitmaps([logo, title], 'horizontal');
 * const fullLabel = stackBitmaps([labelTop, body], 'vertical');
 * ```
 */
export function stackBitmaps(
  bitmaps: readonly LabelBitmap[],
  direction: 'horizontal' | 'vertical',
): LabelBitmap {
  if (bitmaps.length === 0) throw new RangeError('bitmaps must not be empty');
  if (bitmaps.length === 1) {
    const only = bitmaps[0];
    if (!only) throw new RangeError('bitmaps must not be empty');
    return { widthPx: only.widthPx, heightPx: only.heightPx, data: new Uint8Array(only.data) };
  }

  if (direction === 'horizontal') {
    const first = bitmaps[0];
    if (!first) throw new RangeError('bitmaps must not be empty');
    const height = first.heightPx;
    if (!bitmaps.every(b => b.heightPx === height))
      throw new RangeError('all heights must match for horizontal stack');
    const width = bitmaps.reduce((sum, b) => sum + b.widthPx, 0);
    const rowBytes = Math.ceil(width / 8);
    const data = new Uint8Array(height * rowBytes);
    for (let y = 0; y < height; y += 1) {
      let offsetX = 0;
      for (const bmp of bitmaps) {
        for (let x = 0; x < bmp.widthPx; x += 1) {
          setPixel(data, rowBytes, offsetX + x, y, getPixel(bmp, x, y));
        }
        offsetX += bmp.widthPx;
      }
    }
    return { widthPx: width, heightPx: height, data };
  }

  const first = bitmaps[0];
  if (!first) throw new RangeError('bitmaps must not be empty');
  const width = first.widthPx;
  if (!bitmaps.every(b => b.widthPx === width))
    throw new RangeError('all widths must match for vertical stack');
  const totalHeight = bitmaps.reduce((sum, b) => sum + b.heightPx, 0);
  const rowBytes = Math.ceil(width / 8);
  const data = new Uint8Array(totalHeight * rowBytes);
  let offsetY = 0;
  for (const bmp of bitmaps) {
    for (let y = 0; y < bmp.heightPx; y += 1) {
      for (let x = 0; x < width; x += 1) {
        setPixel(data, rowBytes, x, y + offsetY, getPixel(bmp, x, y));
      }
    }
    offsetY += bmp.heightPx;
  }
  return { widthPx: width, heightPx: totalHeight, data };
}

/**
 * Add white margins around an existing bitmap.
 *
 * Each side defaults to 0; only specify the sides you need.
 *
 * @param bitmap - Source bitmap.
 * @param padding - Margins in pixels per side.
 * @returns A new bitmap with the original content offset by `padding.left`/`padding.top`.
 *
 * @example
 * ```ts
 * const padded = padBitmap(content, { top: 4, bottom: 4, left: 8, right: 8 });
 * ```
 */
export function padBitmap(
  bitmap: LabelBitmap,
  padding: { top?: number; right?: number; bottom?: number; left?: number },
): LabelBitmap {
  const top = padding.top ?? 0;
  const right = padding.right ?? 0;
  const bottom = padding.bottom ?? 0;
  const left = padding.left ?? 0;
  const newW = bitmap.widthPx + left + right;
  const newH = bitmap.heightPx + top + bottom;
  const rowBytes = Math.ceil(newW / 8);
  const data = new Uint8Array(newH * rowBytes);
  for (let y = 0; y < bitmap.heightPx; y += 1) {
    for (let x = 0; x < bitmap.widthPx; x += 1) {
      setPixel(data, rowBytes, x + left, y + top, getPixel(bitmap, x, y));
    }
  }
  return { widthPx: newW, heightPx: newH, data };
}
