// eslint-disable-next-line @typescript-eslint/no-import-type-side-effects
import { type LabelBitmap } from './types.js';

export function getRow(bitmap: LabelBitmap, y: number): Uint8Array {
  if (y < 0 || y >= bitmap.heightPx) {
    throw new RangeError(`row ${String(y)} out of bounds`);
  }
  const rowBytes = bytesPerRow(bitmap.widthPx);
  return bitmap.data.slice(y * rowBytes, y * rowBytes + rowBytes);
}

export function* iterRows(bitmap: LabelBitmap): Generator<Uint8Array> {
  const rowBytes = bytesPerRow(bitmap.widthPx);
  for (let y = 0; y < bitmap.heightPx; y += 1) {
    yield bitmap.data.subarray(y * rowBytes, y * rowBytes + rowBytes);
  }
}

export function bytesPerRow(widthPx: number): number {
  return Math.ceil(widthPx / 8);
}

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
