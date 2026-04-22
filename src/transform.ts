import type { LabelBitmap } from './types.js';

export function getPixel(bitmap: LabelBitmap, x: number, y: number): boolean {
  const rowBytes = Math.ceil(bitmap.widthPx / 8);
  const byteIdx = y * rowBytes + Math.floor(x / 8);
  return ((bitmap.data[byteIdx]! >> (7 - (x % 8))) & 1) === 1;
}

function setPixel(data: Uint8Array, rowBytes: number, x: number, y: number, black: boolean): void {
  const byteIdx = y * rowBytes + Math.floor(x / 8);
  const bit = 1 << (7 - (x % 8));
  if (black) {
    data[byteIdx]! |= bit;
  } else {
    data[byteIdx]! &= ~bit;
  }
}

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

export function invertBitmap(bitmap: LabelBitmap): LabelBitmap {
  const { widthPx, heightPx } = bitmap;
  const rowBytes = Math.ceil(widthPx / 8);
  const data = new Uint8Array(bitmap.data);
  const trailingBits = widthPx % 8;
  const mask = trailingBits === 0 ? 0xff : ((0xff << (8 - trailingBits)) & 0xff);
  for (let y = 0; y < heightPx; y += 1) {
    for (let b = 0; b < rowBytes; b += 1) {
      const idx = y * rowBytes + b;
      data[idx] = (~data[idx]!) & (b === rowBytes - 1 ? mask : 0xff);
    }
  }
  return { widthPx, heightPx, data };
}

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

export function cropBitmap(bitmap: LabelBitmap, x: number, y: number, widthPx: number, heightPx: number): LabelBitmap {
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

export function stackBitmaps(bitmaps: readonly LabelBitmap[], direction: 'horizontal' | 'vertical'): LabelBitmap {
  if (bitmaps.length === 0) throw new RangeError('bitmaps must not be empty');
  if (bitmaps.length === 1) {
    const only = bitmaps[0]!;
    return { widthPx: only.widthPx, heightPx: only.heightPx, data: new Uint8Array(only.data) };
  }

  if (direction === 'horizontal') {
    const height = bitmaps[0]!.heightPx;
    if (!bitmaps.every((b) => b.heightPx === height)) throw new RangeError('all heights must match for horizontal stack');
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

  const width = bitmaps[0]!.widthPx;
  if (!bitmaps.every((b) => b.widthPx === width)) throw new RangeError('all widths must match for vertical stack');
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
