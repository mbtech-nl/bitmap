import type { LabelBitmap } from './types.js';

/**
 * Copy one packed row of a bitmap.
 *
 * Returns a fresh `Uint8Array` of length `bytesPerRow(bitmap.widthPx)` —
 * useful for writing a single row to a transport buffer. For zero-copy
 * iteration over every row, use {@link iterRows}.
 *
 * @param bitmap - Source bitmap.
 * @param y - Row index (0 ≤ y < bitmap.heightPx).
 * @throws {RangeError} If `y` is out of bounds.
 *
 * @example
 * ```ts
 * const firstRow = getRow(bitmap, 0);
 * ```
 */
export function getRow(bitmap: LabelBitmap, y: number): Uint8Array {
  if (y < 0 || y >= bitmap.heightPx) {
    throw new RangeError(`row ${String(y)} out of bounds`);
  }
  const rowBytes = bytesPerRow(bitmap.widthPx);
  return bitmap.data.slice(y * rowBytes, y * rowBytes + rowBytes);
}

/**
 * Iterate packed rows of a bitmap top-to-bottom.
 *
 * Yields zero-copy `Uint8Array` views over the bitmap's underlying buffer
 * (subarrays, not copies). Mutating a yielded row mutates the bitmap. Use
 * for streaming a bitmap to a printer or encoder line-by-line without
 * allocating per row.
 *
 * @param bitmap - Source bitmap.
 *
 * @example
 * ```ts
 * for (const row of iterRows(bitmap)) {
 *   await transport.write(row);
 * }
 * ```
 */
export function* iterRows(bitmap: LabelBitmap): Generator<Uint8Array> {
  const rowBytes = bytesPerRow(bitmap.widthPx);
  for (let y = 0; y < bitmap.heightPx; y += 1) {
    yield bitmap.data.subarray(y * rowBytes, y * rowBytes + rowBytes);
  }
}

/**
 * Number of packed bytes used to store one row of `widthPx` pixels.
 *
 * Equivalent to `Math.ceil(widthPx / 8)` — exposed as a named function so
 * call sites read clearly and so future encoders can rely on a single
 * authoritative implementation.
 *
 * @example
 * ```ts
 * bytesPerRow(384); // 48
 * bytesPerRow(385); // 49
 * ```
 */
export function bytesPerRow(widthPx: number): number {
  return Math.ceil(widthPx / 8);
}

/**
 * Allocate an empty (all-white) bitmap.
 *
 * @param widthPx - Width in pixels (positive integer).
 * @param heightPx - Height in pixels (positive integer).
 * @returns A bitmap with `data` zero-filled.
 * @throws {RangeError} If either dimension is not a positive integer.
 *
 * @example
 * ```ts
 * const blank = createBitmap(384, 64);
 * ```
 */
export function createBitmap(widthPx: number, heightPx: number): LabelBitmap {
  if (!Number.isInteger(widthPx) || widthPx < 1) {
    throw new RangeError('widthPx must be a positive integer');
  }
  if (!Number.isInteger(heightPx) || heightPx < 1) {
    throw new RangeError('heightPx must be a positive integer');
  }

  return {
    widthPx,
    heightPx,
    data: new Uint8Array(heightPx * bytesPerRow(widthPx)),
  };
}

/**
 * Compare two bitmaps for byte-equal equality.
 *
 * Returns `true` only when dimensions match and every byte of `data` is
 * identical. Useful for snapshot tests; not appropriate for visual
 * similarity (use `getPixel` or a perceptual diff for that).
 *
 * @example
 * ```ts
 * expect(bitmapEquals(actual, expected)).toBe(true);
 * ```
 */
export function bitmapEquals(a: LabelBitmap, b: LabelBitmap): boolean {
  if (a.widthPx !== b.widthPx || a.heightPx !== b.heightPx) {
    return false;
  }
  if (a.data.length !== b.data.length) {
    return false;
  }
  return a.data.every((byte, index) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return byte === b.data[index]!;
  });
}
