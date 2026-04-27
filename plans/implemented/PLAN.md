# @mbtech-nl/bitmap — Implementation Plan

> Agent implementation plan for the shared 1-bit-per-pixel bitmap rendering
> core. This package is a hard dependency of all three driver packages
> (labelmanager-ts, labelwriter-ts, brother-ql-ts) and of
> @labelkit/designer-core. It must be written, tested exhaustively, and
> published to npm before any other package in the thermal-label ecosystem
> is started.
>
> Zero runtime dependencies. Runs identically in Node.js 24 and all modern
> browsers. Pure TypeScript, no native addons, no DOM APIs.

---

## 0. Repository Bootstrap

**Repo:** `github.com/mbtech-nl/bitmap`  
**npm package:** `@mbtech-nl/bitmap`  
**Node:** `>=24.0.0`  
**Package manager:** `pnpm >=9`

This is a single-package repo — not a monorepo. There is one publishable
package at the root. No `packages/` subdirectory.

```
bitmap/
├── .github/
│   ├── FUNDING.yml
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
├── src/
│   ├── index.ts              public API barrel
│   ├── types.ts              all exported types
│   ├── font/
│   │   ├── font8x8.ts        bundled pixel font data
│   │   └── render.ts         text → bitmap
│   ├── image.ts              RawImageData → bitmap
│   ├── dither.ts             Floyd-Steinberg dithering
│   ├── transform.ts          rotate, flip, invert, scale, crop, stack
│   ├── encode.ts             LabelBitmap ↔ Uint8Array serialisation helpers
│   └── __tests__/
│       ├── font.test.ts
│       ├── image.test.ts
│       ├── dither.test.ts
│       ├── transform.test.ts
│       ├── encode.test.ts
│       └── fixtures/         known-good binary snapshots for regression tests
├── LICENSE
├── package.json
├── eslint.config.js
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
└── README.md
```

---

## 1. LICENSE

```
MIT License

Copyright (c) 2025 Mannes Brak

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. `eslint.config.js`

```js
import mbtech from '@mbtech-nl/eslint-config';

export default [...mbtech];
```

---

## 3. package.json

```json
{
  "name": "@mbtech-nl/bitmap",
  "version": "0.1.0",
  "description": "Shared 1bpp bitmap rendering core for thermal label printers",
  "license": "MIT",
  "author": "Mannes Brak",
  "homepage": "https://github.com/mbtech-nl/bitmap",
  "repository": {
    "type": "git",
    "url": "https://github.com/mbtech-nl/bitmap.git"
  },
  "engines": { "node": ">=24.0.0", "pnpm": ">=9.0.0" },
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "LICENSE"],
  "sideEffects": false,
  "prettier": "@mbtech-nl/prettier-config",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src",
    "format": "prettier --write src"
  },
  "devDependencies": {
    "@mbtech-nl/eslint-config": "^1.0.0",
    "@mbtech-nl/prettier-config": "^1.0.0",
    "@mbtech-nl/tsconfig": "^1.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "typescript": "~5.5.0",
    "vitest": "^2.0.0"
  },
  "funding": [
    {
      "type": "github",
      "url": "https://github.com/sponsors/mannes"
    },
    {
      "type": "ko-fi",
      "url": "https://ko-fi.com/mannes"
    }
  ]
}
```

---

## 4. TypeScript Configuration

### `tsconfig.json` (for type checking during development)

```json
{
  "extends": "@mbtech-nl/tsconfig/base",
  "compilerOptions": {
    "rootDir": "src",
    "noEmit": true
  },
  "include": ["src"]
}
```

### `tsconfig.build.json` (for publishing)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["src/__tests__"]
}
```

---

## 5. Types (`src/types.ts`)

These are the foundational types consumed by every downstream package.
Define them carefully — changing them later is a breaking change.

```typescript
/**
 * A 1-bit-per-pixel bitmap. Row-major, MSB-first within each byte.
 *
 * Memory layout:
 *   Row y, pixel x → byte index: y * bytesPerRow + Math.floor(x / 8)
 *                  → bit index:  7 - (x % 8)   (MSB = leftmost pixel)
 *
 * A set bit (1) = black dot. A clear bit (0) = white dot.
 */
export interface LabelBitmap {
  /** Number of pixel columns */
  readonly widthPx: number;
  /** Number of pixel rows */
  readonly heightPx: number;
  /**
   * Packed pixel data.
   * Length must equal heightPx * Math.ceil(widthPx / 8).
   */
  readonly data: Uint8Array;
}

/**
 * Raw RGBA image data, compatible with browser ImageData and
 * @napi-rs/canvas ImageData.
 */
export interface RawImageData {
  readonly width: number;
  readonly height: number;
  /** RGBA bytes, 4 bytes per pixel, row-major. Length = width * height * 4. */
  readonly data: Uint8Array;
}

/** Options for rendering text to a LabelBitmap */
export interface TextRenderOptions {
  /**
   * Built-in font to use.
   * @default 'default8x8'
   */
  font?: BuiltinFont;
  /**
   * Integer horizontal scale factor. Pixel-doubles the font.
   * @default 1
   */
  scaleX?: number;
  /**
   * Integer vertical scale factor. Pixel-doubles the font.
   * @default 1
   */
  scaleY?: number;
  /**
   * Horizontal spacing added between characters, in source pixels
   * (before scaling).
   * @default 1
   */
  letterSpacing?: number;
  /**
   * If true, render white text on black background.
   * @default false
   */
  invert?: boolean;
}

/** Options for converting RawImageData to a LabelBitmap */
export interface ImageRenderOptions {
  /**
   * Threshold for black/white conversion (0–255).
   * Pixels with luminance below this value become black.
   * @default 128
   */
  threshold?: number;
  /**
   * Use Floyd-Steinberg dithering instead of simple threshold.
   * When true, `threshold` is ignored.
   * @default false
   */
  dither?: boolean;
  /**
   * Invert the output bitmap.
   * @default false
   */
  invert?: boolean;
  /**
   * Rotate the image before conversion.
   * @default 0
   */
  rotate?: 0 | 90 | 180 | 270;
}

/** Built-in pixel fonts */
export type BuiltinFont = 'default8x8';

/** Pixel dimensions of a built-in font character */
export interface FontMetrics {
  charWidth: number;
  charHeight: number;
}
```

---

## 6. Bundled Pixel Font (`src/font/font8x8.ts`)

A complete 8×8 pixel bitmap font covering ASCII characters 32–127 (space
through tilde). Each character is exactly 8 bytes, one byte per row, MSB =
leftmost pixel.

The font data is a `Uint8Array` of length 768 (96 characters × 8 bytes).
Character N (where N = ASCII code − 32) starts at byte offset `N * 8`.

```typescript
/**
 * 8×8 pixel bitmap font, ASCII 32–127.
 * Character N starts at byte offset (charCode - 32) * 8.
 * Each byte is one row, MSB = leftmost pixel.
 * A set bit = filled pixel (black).
 */
export const FONT_8X8: Uint8Array = new Uint8Array([
  // 0x20 ' ' (space)
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  // 0x21 '!'
  0x18, 0x18, 0x18, 0x18, 0x18, 0x00, 0x18, 0x00,
  // 0x22 '"'
  0x66, 0x66, 0x24, 0x00, 0x00, 0x00, 0x00, 0x00,
  // ... continue for all 96 characters through 0x7E '~'
  // 0x7F DEL (not printable, use blank)
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

export const FONT_8X8_METRICS: FontMetrics = {
  charWidth: 8,
  charHeight: 8,
};
```

**Agent instruction:** Use a well-known open-license 8×8 pixel font for the
actual glyph data. Good sources:
- The classic IBM CP437 8×8 font (public domain)
- Tom Thumb font adapted to 8×8 (MIT)
- Proggy fonts family (MIT)

Do not invent glyph data. Copy verbatim from a verifiable open-license source
and record the source and license in a comment at the top of the file.

---

## 7. Text Renderer (`src/font/render.ts`)

```typescript
import { FONT_8X8, FONT_8X8_METRICS } from './font8x8.js';
import type { LabelBitmap, TextRenderOptions, BuiltinFont } from '../types.js';

const FONTS = {
  default8x8: { data: FONT_8X8, metrics: FONT_8X8_METRICS },
} satisfies Record<BuiltinFont, { data: Uint8Array; metrics: FontMetrics }>;

/**
 * Render a string to a LabelBitmap using the bundled pixel font.
 *
 * Characters not in the ASCII 32–127 range are replaced with a
 * space character. Multi-line text is not supported — callers
 * should split lines and stack the resulting bitmaps.
 *
 * @param text - The string to render. Must not be empty.
 * @param options - Rendering options.
 * @returns A LabelBitmap containing the rendered text.
 * @throws {RangeError} If text is empty.
 *
 * @example
 * const bmp = renderText('HELLO', { scaleX: 2, scaleY: 2 });
 * // bmp.widthPx = 5 chars × 8px × 2 + 4 gaps × 1px × 2 = 88
 * // bmp.heightPx = 8px × 2 = 16
 */
export function renderText(text: string, options: TextRenderOptions = {}): LabelBitmap {
  if (text.length === 0) throw new RangeError('text must not be empty');

  const {
    font = 'default8x8',
    scaleX = 1,
    scaleY = 1,
    letterSpacing = 1,
    invert = false,
  } = options;

  if (!Number.isInteger(scaleX) || scaleX < 1) throw new RangeError('scaleX must be a positive integer');
  if (!Number.isInteger(scaleY) || scaleY < 1) throw new RangeError('scaleY must be a positive integer');

  const { data: fontData, metrics } = FONTS[font];
  const { charWidth, charHeight } = metrics;

  // Replace non-printable / out-of-range characters with space
  const chars = [...text].map(c => {
    const code = c.codePointAt(0) ?? 32;
    return (code >= 32 && code <= 127) ? code : 32;
  });

  const gapPx = letterSpacing;
  const totalWidth = chars.length * charWidth + (chars.length - 1) * gapPx;
  const widthPx = totalWidth * scaleX;
  const heightPx = charHeight * scaleY;
  const bytesPerRow = Math.ceil(widthPx / 8);
  const data = new Uint8Array(heightPx * bytesPerRow); // zero = white

  for (let charIndex = 0; charIndex < chars.length; charIndex++) {
    const charCode = chars[charIndex]!;
    const fontOffset = (charCode - 32) * charHeight;
    const charX = charIndex * (charWidth + gapPx);

    for (let row = 0; row < charHeight; row++) {
      const fontByte = fontData[fontOffset + row]!;

      for (let col = 0; col < charWidth; col++) {
        const srcBit = (fontByte >> (7 - col)) & 1;
        if (srcBit === 0) continue; // white pixel, data already zero

        // Scale: write scaleX × scaleY block of pixels
        for (let sy = 0; sy < scaleY; sy++) {
          for (let sx = 0; sx < scaleX; sx++) {
            const px = (charX + col) * scaleX + sx;
            const py = row * scaleY + sy;
            const byteIdx = py * bytesPerRow + Math.floor(px / 8);
            const bitIdx = 7 - (px % 8);
            data[byteIdx]! |= (1 << bitIdx);
          }
        }
      }
    }
  }

  if (invert) {
    // Invert all bytes; mask trailing bits in last byte of each row to zero
    const trailingBits = widthPx % 8;
    const trailMask = trailingBits === 0 ? 0xFF : (0xFF << (8 - trailingBits)) & 0xFF;
    for (let row = 0; row < heightPx; row++) {
      for (let col = 0; col < bytesPerRow; col++) {
        const idx = row * bytesPerRow + col;
        const mask = col === bytesPerRow - 1 ? trailMask : 0xFF;
        data[idx] = (~data[idx]!) & mask;
      }
    }
  }

  return { widthPx, heightPx, data };
}

/**
 * Return the pixel dimensions of a rendered string without allocating a bitmap.
 * Useful for layout calculations.
 */
export function measureText(text: string, options: TextRenderOptions = {}): { widthPx: number; heightPx: number } {
  const { font = 'default8x8', scaleX = 1, scaleY = 1, letterSpacing = 1 } = options;
  const { metrics } = FONTS[font];
  const { charWidth, charHeight } = metrics;
  const totalWidth = text.length * charWidth + Math.max(0, text.length - 1) * letterSpacing;
  return { widthPx: totalWidth * scaleX, heightPx: charHeight * scaleY };
}
```

---

## 8. Image Converter (`src/image.ts`)

```typescript
import type { LabelBitmap, RawImageData, ImageRenderOptions } from './types.js';
import { floydSteinberg } from './dither.js';
import { rotateBitmap } from './transform.js';

/**
 * Convert a RawImageData (RGBA) to a 1bpp LabelBitmap.
 *
 * @param image - Source RGBA image data.
 * @param options - Conversion options.
 * @returns A LabelBitmap.
 * @throws {RangeError} If image dimensions are zero.
 *
 * @example
 * const bitmap = renderImage(imageData, { dither: true });
 */
export function renderImage(image: RawImageData, options: ImageRenderOptions = {}): LabelBitmap {
  if (image.width === 0 || image.height === 0) {
    throw new RangeError('image dimensions must be non-zero');
  }
  if (image.data.length !== image.width * image.height * 4) {
    throw new RangeError('image.data length does not match dimensions');
  }

  const { threshold = 128, dither = false, invert = false, rotate = 0 } = options;

  // Step 1: convert RGBA → greyscale luminance (0–255 float array)
  const luminance = rgbaToLuminance(image);

  // Step 2: threshold or dither to 1bpp
  const { widthPx, heightPx, data } = dither
    ? floydSteinberg(luminance, image.width, image.height, invert)
    : thresholdToBitmap(luminance, image.width, image.height, threshold, invert);

  let result: LabelBitmap = { widthPx, heightPx, data };

  // Step 3: rotate if requested
  if (rotate !== 0) {
    result = rotateBitmap(result, rotate);
  }

  return result;
}

/**
 * Convert RGBA pixel data to a flat Float32Array of luminance values (0–1).
 * Uses the BT.601 luma coefficients: Y = 0.299R + 0.587G + 0.114B.
 * Alpha is not composited — assumed fully opaque white background.
 */
function rgbaToLuminance(image: RawImageData): Float32Array {
  const { width, height, data } = image;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4]! / 255;
    const g = data[i * 4 + 1]! / 255;
    const b = data[i * 4 + 2]! / 255;
    const a = data[i * 4 + 3]! / 255;
    // Composite onto white background
    const rl = r * a + (1 - a);
    const gl = g * a + (1 - a);
    const bl = b * a + (1 - a);
    luma[i] = 0.299 * rl + 0.587 * gl + 0.114 * bl;
  }
  return luma;
}

function thresholdToBitmap(
  luminance: Float32Array,
  width: number,
  height: number,
  threshold: number,
  invert: boolean,
): LabelBitmap {
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(height * bytesPerRow);
  const thresholdNorm = threshold / 255;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const luma = luminance[y * width + x]!;
      // Below threshold = dark pixel = set bit (unless inverted)
      const isBlack = invert ? luma >= thresholdNorm : luma < thresholdNorm;
      if (isBlack) {
        const byteIdx = y * bytesPerRow + Math.floor(x / 8);
        data[byteIdx]! |= 1 << (7 - (x % 8));
      }
    }
  }

  return { widthPx: width, heightPx: height, data };
}
```

---

## 9. Floyd-Steinberg Dithering (`src/dither.ts`)

```typescript
import type { LabelBitmap } from './types.js';

/**
 * Apply Floyd-Steinberg error-diffusion dithering to a luminance map,
 * producing a 1bpp LabelBitmap.
 *
 * Floyd-Steinberg error diffusion pattern:
 *        [curr]  7/16
 *  3/16   5/16   1/16
 *
 * @param luminance - Float32Array of luminance values (0–1), row-major.
 * @param width     - Image width in pixels.
 * @param height    - Image height in pixels.
 * @param invert    - If true, dark pixels become white and vice versa.
 */
export function floydSteinberg(
  luminance: Float32Array,
  width: number,
  height: number,
  invert: boolean,
): LabelBitmap {
  // Work on a mutable copy to avoid modifying the input
  const pixels = new Float32Array(luminance);
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(height * bytesPerRow);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldPixel = pixels[idx]!;
      // Quantise: 0 = black, 1 = white
      const newPixel = oldPixel < 0.5 ? 0 : 1;
      pixels[idx] = newPixel;

      const error = oldPixel - newPixel;

      // Distribute error to neighbours — bounds-check every write
      if (x + 1 < width)
        pixels[idx + 1]! += error * (7 / 16);
      if (y + 1 < height) {
        if (x - 1 >= 0)
          pixels[idx + width - 1]! += error * (3 / 16);
        pixels[idx + width]! += error * (5 / 16);
        if (x + 1 < width)
          pixels[idx + width + 1]! += error * (1 / 16);
      }

      // newPixel === 0 means black dot
      const isBlack = invert ? newPixel === 1 : newPixel === 0;
      if (isBlack) {
        const byteIdx = y * bytesPerRow + Math.floor(x / 8);
        data[byteIdx]! |= 1 << (7 - (x % 8));
      }
    }
  }

  return { widthPx: width, heightPx: height, data };
}
```

---

## 10. Transforms (`src/transform.ts`)

```typescript
import type { LabelBitmap } from './types.js';

/**
 * Read a single pixel from a LabelBitmap.
 * Returns true if the pixel is black (set bit).
 */
export function getPixel(bitmap: LabelBitmap, x: number, y: number): boolean {
  const bytesPerRow = Math.ceil(bitmap.widthPx / 8);
  const byteIdx = y * bytesPerRow + Math.floor(x / 8);
  return ((bitmap.data[byteIdx]! >> (7 - (x % 8))) & 1) === 1;
}

/**
 * Write a single pixel to a mutable bitmap data buffer.
 */
function setPixel(data: Uint8Array, bytesPerRow: number, x: number, y: number, black: boolean): void {
  const byteIdx = y * bytesPerRow + Math.floor(x / 8);
  const bit = 1 << (7 - (x % 8));
  if (black) {
    data[byteIdx]! |= bit;
  } else {
    data[byteIdx]! &= ~bit;
  }
}

/**
 * Rotate a LabelBitmap by 90, 180, or 270 degrees clockwise.
 *
 * @example
 * const rotated = rotateBitmap(bitmap, 90);
 * // rotated.widthPx === bitmap.heightPx
 * // rotated.heightPx === bitmap.widthPx
 */
export function rotateBitmap(bitmap: LabelBitmap, degrees: 90 | 180 | 270): LabelBitmap {
  const { widthPx: w, heightPx: h } = bitmap;

  if (degrees === 180) {
    const bytesPerRow = Math.ceil(w / 8);
    const data = new Uint8Array(h * bytesPerRow);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        setPixel(data, bytesPerRow, w - 1 - x, h - 1 - y, getPixel(bitmap, x, y));
      }
    }
    return { widthPx: w, heightPx: h, data };
  }

  // 90 or 270 — dimensions swap
  const newW = h;
  const newH = w;
  const bytesPerRow = Math.ceil(newW / 8);
  const data = new Uint8Array(newH * bytesPerRow);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const black = getPixel(bitmap, x, y);
      if (degrees === 90) {
        // (x, y) → (h - 1 - y, x)
        setPixel(data, bytesPerRow, h - 1 - y, x, black);
      } else {
        // 270: (x, y) → (y, w - 1 - x)
        setPixel(data, bytesPerRow, y, w - 1 - x, black);
      }
    }
  }

  return { widthPx: newW, heightPx: newH, data };
}

/**
 * Flip a LabelBitmap horizontally (mirror left-right).
 */
export function flipHorizontal(bitmap: LabelBitmap): LabelBitmap {
  const { widthPx: w, heightPx: h } = bitmap;
  const bytesPerRow = Math.ceil(w / 8);
  const data = new Uint8Array(h * bytesPerRow);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      setPixel(data, bytesPerRow, w - 1 - x, y, getPixel(bitmap, x, y));
    }
  }
  return { widthPx: w, heightPx: h, data };
}

/**
 * Flip a LabelBitmap vertically (mirror top-bottom).
 */
export function flipVertical(bitmap: LabelBitmap): LabelBitmap {
  const { widthPx: w, heightPx: h } = bitmap;
  const bytesPerRow = Math.ceil(w / 8);
  const data = new Uint8Array(h * bytesPerRow);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      setPixel(data, bytesPerRow, x, h - 1 - y, getPixel(bitmap, x, y));
    }
  }
  return { widthPx: w, heightPx: h, data };
}

/**
 * Invert all pixels in a LabelBitmap (black ↔ white).
 * Correctly masks trailing bits in the last byte of each row.
 */
export function invertBitmap(bitmap: LabelBitmap): LabelBitmap {
  const { widthPx, heightPx } = bitmap;
  const bytesPerRow = Math.ceil(widthPx / 8);
  const data = new Uint8Array(bitmap.data);
  const trailingBits = widthPx % 8;
  const trailMask = trailingBits === 0 ? 0xFF : (0xFF << (8 - trailingBits)) & 0xFF;

  for (let y = 0; y < heightPx; y++) {
    for (let col = 0; col < bytesPerRow; col++) {
      const idx = y * bytesPerRow + col;
      const mask = col === bytesPerRow - 1 ? trailMask : 0xFF;
      data[idx] = (~data[idx]!) & mask;
    }
  }

  return { widthPx, heightPx, data };
}

/**
 * Scale a LabelBitmap to a target height using nearest-neighbour resampling.
 * Width is scaled proportionally to maintain aspect ratio.
 *
 * @param bitmap      - Source bitmap.
 * @param targetHeight - Target height in pixels. Must be a positive integer.
 */
export function scaleBitmap(bitmap: LabelBitmap, targetHeight: number): LabelBitmap {
  if (!Number.isInteger(targetHeight) || targetHeight < 1) {
    throw new RangeError('targetHeight must be a positive integer');
  }
  const { widthPx: srcW, heightPx: srcH } = bitmap;
  const targetWidth = Math.round(srcW * (targetHeight / srcH));
  const bytesPerRow = Math.ceil(targetWidth / 8);
  const data = new Uint8Array(targetHeight * bytesPerRow);

  for (let y = 0; y < targetHeight; y++) {
    const srcY = Math.floor(y * srcH / targetHeight);
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.floor(x * srcW / targetWidth);
      setPixel(data, bytesPerRow, x, y, getPixel(bitmap, srcX, srcY));
    }
  }

  return { widthPx: targetWidth, heightPx: targetHeight, data };
}

/**
 * Crop a LabelBitmap to a sub-rectangle.
 *
 * @throws {RangeError} If the crop region exceeds bitmap bounds.
 */
export function cropBitmap(
  bitmap: LabelBitmap,
  x: number,
  y: number,
  width: number,
  height: number,
): LabelBitmap {
  if (x < 0 || y < 0 || x + width > bitmap.widthPx || y + height > bitmap.heightPx) {
    throw new RangeError('crop region exceeds bitmap bounds');
  }
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(height * bytesPerRow);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      setPixel(data, bytesPerRow, px, py, getPixel(bitmap, x + px, y + py));
    }
  }
  return { widthPx: width, heightPx: height, data };
}

/**
 * Stack multiple bitmaps horizontally (left to right) or vertically
 * (top to bottom). All bitmaps must have the same dimension on the
 * stacking axis:
 * - horizontal: all must have the same heightPx
 * - vertical:   all must have the same widthPx
 *
 * @throws {RangeError} If bitmaps array is empty or dimensions mismatch.
 */
export function stackBitmaps(
  bitmaps: LabelBitmap[],
  direction: 'horizontal' | 'vertical',
): LabelBitmap {
  if (bitmaps.length === 0) throw new RangeError('bitmaps array must not be empty');

  if (direction === 'horizontal') {
    const height = bitmaps[0]!.heightPx;
    if (!bitmaps.every(b => b.heightPx === height)) {
      throw new RangeError('all bitmaps must have the same heightPx for horizontal stacking');
    }
    const totalWidth = bitmaps.reduce((sum, b) => sum + b.widthPx, 0);
    const bytesPerRow = Math.ceil(totalWidth / 8);
    const data = new Uint8Array(height * bytesPerRow);
    let offsetX = 0;
    for (const bmp of bitmaps) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < bmp.widthPx; x++) {
          setPixel(data, bytesPerRow, offsetX + x, y, getPixel(bmp, x, y));
        }
      }
      offsetX += bmp.widthPx;
    }
    return { widthPx: totalWidth, heightPx: height, data };
  } else {
    const width = bitmaps[0]!.widthPx;
    if (!bitmaps.every(b => b.widthPx === width)) {
      throw new RangeError('all bitmaps must have the same widthPx for vertical stacking');
    }
    const totalHeight = bitmaps.reduce((sum, b) => sum + b.heightPx, 0);
    const bytesPerRow = Math.ceil(width / 8);
    const data = new Uint8Array(totalHeight * bytesPerRow);
    let offsetY = 0;
    for (const bmp of bitmaps) {
      for (let y = 0; y < bmp.heightPx; y++) {
        for (let x = 0; x < width; x++) {
          setPixel(data, bytesPerRow, x, offsetY + y, getPixel(bmp, x, y));
        }
      }
      offsetY += bmp.heightPx;
    }
    return { widthPx: width, heightPx: totalHeight, data };
  }
}

/**
 * Pad a LabelBitmap with white pixels on any side.
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
  const bytesPerRow = Math.ceil(newW / 8);
  const data = new Uint8Array(newH * bytesPerRow); // zero = white
  for (let y = 0; y < bitmap.heightPx; y++) {
    for (let x = 0; x < bitmap.widthPx; x++) {
      setPixel(data, bytesPerRow, x + left, y + top, getPixel(bitmap, x, y));
    }
  }
  return { widthPx: newW, heightPx: newH, data };
}
```

---

## 11. Encode Helpers (`src/encode.ts`)

Utilities consumed by the driver packages to read bitmap data efficiently
without re-implementing bit manipulation.

```typescript
import type { LabelBitmap } from './types.js';

/**
 * Extract a single row of a LabelBitmap as a Uint8Array of packed bytes.
 * The returned array has Math.ceil(bitmap.widthPx / 8) bytes.
 * This is a copy — mutations do not affect the bitmap.
 */
export function getRow(bitmap: LabelBitmap, y: number): Uint8Array {
  if (y < 0 || y >= bitmap.heightPx) throw new RangeError(`row ${y} out of bounds`);
  const bytesPerRow = Math.ceil(bitmap.widthPx / 8);
  return bitmap.data.slice(y * bytesPerRow, y * bytesPerRow + bytesPerRow);
}

/**
 * Iterate over all rows of a LabelBitmap, yielding each row as a Uint8Array.
 * Memory-efficient: each yielded array is a view, not a copy.
 */
export function* iterRows(bitmap: LabelBitmap): Generator<Uint8Array> {
  const bytesPerRow = Math.ceil(bitmap.widthPx / 8);
  for (let y = 0; y < bitmap.heightPx; y++) {
    yield bitmap.data.subarray(y * bytesPerRow, y * bytesPerRow + bytesPerRow);
  }
}

/**
 * Return the number of bytes per row for a given pixel width.
 * This is Math.ceil(widthPx / 8) but exported for driver use.
 */
export function bytesPerRow(widthPx: number): number {
  return Math.ceil(widthPx / 8);
}

/**
 * Create a new empty (all-white) LabelBitmap of the given dimensions.
 */
export function createBitmap(widthPx: number, heightPx: number): LabelBitmap {
  if (widthPx < 1 || heightPx < 1) throw new RangeError('dimensions must be positive');
  return {
    widthPx,
    heightPx,
    data: new Uint8Array(heightPx * Math.ceil(widthPx / 8)),
  };
}

/**
 * Compare two LabelBitmaps for equality (same dimensions and pixel data).
 */
export function bitmapEquals(a: LabelBitmap, b: LabelBitmap): boolean {
  if (a.widthPx !== b.widthPx || a.heightPx !== b.heightPx) return false;
  return a.data.every((byte, i) => byte === b.data[i]);
}
```

---

## 12. Public API Barrel (`src/index.ts`)

```typescript
// Types
export type {
  LabelBitmap,
  RawImageData,
  TextRenderOptions,
  ImageRenderOptions,
  BuiltinFont,
  FontMetrics,
} from './types.js';

// Text rendering
export { renderText, measureText } from './font/render.js';

// Image conversion
export { renderImage } from './image.js';

// Dithering (exported for advanced use / custom pipelines)
export { floydSteinberg } from './dither.js';

// Transforms
export {
  getPixel,
  rotateBitmap,
  flipHorizontal,
  flipVertical,
  invertBitmap,
  scaleBitmap,
  cropBitmap,
  stackBitmaps,
  padBitmap,
} from './transform.js';

// Encode helpers (used by driver packages)
export { getRow, iterRows, bytesPerRow, createBitmap, bitmapEquals } from './encode.ts';
```

---

## 13. Tests

### Critical properties to assert in every test

1. `data.length === heightPx * Math.ceil(widthPx / 8)` — always
2. Trailing bits in the last byte of each row are always zero (no garbage)
3. `widthPx` and `heightPx` are always positive integers
4. Functions are pure — the input bitmap is never mutated

### `src/__tests__/font.test.ts`

```typescript
describe('renderText', () => {
  it('throws on empty string');
  it('throws if scaleX is not a positive integer');
  it('throws if scaleY is not a positive integer');
  it('produces correct dimensions for a single character at scale 1');
  it('produces correct dimensions for multiple characters at scale 1');
  it('produces correct dimensions with scaleX=2, scaleY=3');
  it('produces correct dimensions with letterSpacing=0');
  it('produces correct dimensions with letterSpacing=2');
  it('replaces out-of-range characters with space');
  it('data length matches heightPx * ceil(widthPx / 8)');
  it('trailing bits in last byte of each row are zero');
  it('invert: space character becomes all-black');
  it('invert: solid block character becomes all-white');
  it('snapshot: "HELLO" at scale 1 matches known byte output');
  it('snapshot: "HELLO" at scale 2 matches known byte output');
  it('snapshot: "A" inverted matches known byte output');
});

describe('measureText', () => {
  it('returns same dimensions as renderText without allocating');
  it('handles empty string without throwing');
  it('respects scaleX, scaleY, letterSpacing');
});
```

### `src/__tests__/image.test.ts`

```typescript
describe('renderImage', () => {
  it('throws on zero-width image');
  it('throws on zero-height image');
  it('throws if data length does not match dimensions');
  it('all-white RGBA → all-zero bitmap data');
  it('all-black RGBA → all-set bitmap data (within widthPx)');
  it('trailing bits are zero for non-multiple-of-8 widths');
  it('threshold=0 → everything is white (all clear)');
  it('threshold=255 → everything is black (all set)');
  it('invert: all-white input → all-black output');
  it('alpha compositing: transparent pixel on white bg → white output');
  it('rotate=90 swaps dimensions correctly');
  it('rotate=180 preserves dimensions');
  it('rotate=270 swaps dimensions correctly');
  it('data length is correct after rotation');
  it('dither=true produces non-uniform output for mid-grey input');
  it('dither=false produces uniform output for mid-grey input at threshold 128');
  it('snapshot: 8×8 checkerboard pattern matches known output');
});
```

### `src/__tests__/dither.test.ts`

```typescript
describe('floydSteinberg', () => {
  it('all-white input → all-zero output');
  it('all-black input → all-set output');
  it('mid-grey (0.5) produces roughly 50% black pixels');
  it('error does not propagate outside bitmap bounds (no out-of-bounds writes)');
  it('invert flag swaps black and white');
  it('data length matches heightPx * ceil(widthPx / 8)');
  it('trailing bits in each row are zero');
  it('1×1 pixel: below 0.5 → black');
  it('1×1 pixel: above 0.5 → white');
  it('single-row image: no vertical error diffusion attempted');
  it('snapshot: 16×8 gradient matches known dithered output');
});
```

### `src/__tests__/transform.test.ts`

```typescript
describe('rotateBitmap', () => {
  it('90°: widthPx and heightPx are swapped');
  it('180°: dimensions preserved');
  it('270°: widthPx and heightPx are swapped');
  it('90° then 270° returns original pixel layout');
  it('180° then 180° returns original pixel layout');
  it('top-left pixel moves to correct position after each rotation');
  it('data length is correct after each rotation');
  it('trailing bits are zero after rotation');
  it('non-square bitmap rotates correctly');
  it('1×1 bitmap: rotation is a no-op');
});

describe('flipHorizontal / flipVertical', () => {
  it('horizontal: leftmost column becomes rightmost');
  it('vertical: top row becomes bottom row');
  it('flip twice returns original');
  it('dimensions preserved');
  it('data length preserved');
});

describe('invertBitmap', () => {
  it('all-zero → all-set (within valid pixels)');
  it('all-set → all-zero');
  it('trailing bits remain zero after invert');
  it('invert twice returns original');
  it('non-multiple-of-8 width: trailing bits not set');
});

describe('scaleBitmap', () => {
  it('throws if targetHeight is not a positive integer');
  it('same height returns equivalent bitmap');
  it('double height doubles heightPx and scales widthPx proportionally');
  it('data length is correct');
  it('trailing bits are zero');
  it('scale to 1px height does not throw');
});

describe('cropBitmap', () => {
  it('throws if x is negative');
  it('throws if y is negative');
  it('throws if crop region exceeds bitmap width');
  it('throws if crop region exceeds bitmap height');
  it('full-size crop returns equivalent bitmap');
  it('1×1 crop extracts correct pixel');
  it('data length is correct');
  it('trailing bits are zero');
});

describe('stackBitmaps', () => {
  it('throws on empty array');
  it('horizontal: throws if heights differ');
  it('vertical: throws if widths differ');
  it('horizontal: totalWidth equals sum of widths');
  it('vertical: totalHeight equals sum of heights');
  it('horizontal stacking preserves pixel order');
  it('vertical stacking preserves pixel order');
  it('single bitmap returns equivalent bitmap');
  it('data length is correct in both directions');
  it('trailing bits are zero in both directions');
});

describe('padBitmap', () => {
  it('zero padding returns equivalent bitmap');
  it('top padding: original content shifted down');
  it('left padding: original content shifted right');
  it('dimensions increased correctly');
  it('padded area is white (zero bits)');
  it('trailing bits are zero after padding');
});
```

### `src/__tests__/encode.test.ts`

```typescript
describe('getRow', () => {
  it('throws if row is out of bounds');
  it('returns correct bytes for row 0');
  it('returns correct bytes for last row');
  it('returned array is a copy — mutation does not affect original');
  it('length equals ceil(widthPx / 8)');
});

describe('iterRows', () => {
  it('yields heightPx rows');
  it('each yielded row has ceil(widthPx / 8) bytes');
  it('rows are in top-to-bottom order');
});

describe('createBitmap', () => {
  it('throws if widthPx < 1');
  it('throws if heightPx < 1');
  it('all bytes are zero (all white)');
  it('data length is correct');
});

describe('bitmapEquals', () => {
  it('same bitmap → true');
  it('different width → false');
  it('different height → false');
  it('same dimensions different data → false');
  it('two empty bitmaps of same size → true');
});
```

---

## 14. Vitest Configuration (`vitest.config.ts`)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
  },
});
```

Coverage thresholds are enforced. The build fails if coverage drops below them.

---

## 15. GitHub Actions & Repository Files

### `.github/FUNDING.yml`

Powers the Sponsor button on the GitHub repository page.

```yaml
github: mannes
ko_fi: mannes
```

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    name: CI
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v6
        with:
          version: 9

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Format check
        run: prettier --check src

      - name: Test with coverage
        run: pnpm test:coverage

      - name: Build
        run: pnpm build
```

### `.github/workflows/release.yml`

Uses npm trusted publishing — no `NPM_TOKEN` secret required. Configure
the trusted publisher on npmjs.com pointing at this repo and workflow
before the first release.

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write    # create GitHub release
  id-token: write    # npm trusted publishing + provenance

jobs:
  release:
    name: Publish & Release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v6
        with:
          version: 9

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: 'pnpm'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Verify version matches tag
        run: |
          TAG="${GITHUB_REF_NAME#v}"
          PKG_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")
          if [ "$PKG_VERSION" != "$TAG" ]; then
            echo "❌ Version mismatch: package.json has $PKG_VERSION, tag is $TAG"
            exit 1
          fi
          echo "✅ Version $PKG_VERSION matches tag"

      - name: Build
        run: pnpm build

      - name: Test
        run: pnpm test

      - name: Publish to npm
        run: pnpm publish --no-git-checks --access public --provenance

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          make_latest: true
```

---

## 16. README.md — Required Sections

The README must cover:

1. **What this is** — one paragraph, links to the thermal-label org
2. **Install** — `pnpm add @mbtech-nl/bitmap`
3. **Quick example** — renderText + renderImage, 10 lines max
4. **API reference** — link to generated typedoc, plus inline summary table
   of every exported function with its signature and one-line description
5. **Bit layout** — a clear explanation of the `LabelBitmap` memory layout
   (MSB-first, row-major, trailing bits zero). Downstream driver authors need this.
6. **Font** — which font is bundled, its license, its source
7. **Browser support** — works everywhere, no DOM APIs used
8. **Contributing** — link to org CONTRIBUTING.md
9. **License** — MIT

---

## 17. Implementation Order for the Agent

> Before starting, verify that `@mbtech-nl/eslint-config`, `@mbtech-nl/tsconfig`,
> and `@mbtech-nl/prettier-config` are already published to npm from
> `github.com/mbtech-nl/configs`. This package has no dependencies and must
> exist before any other repo in the ecosystem is scaffolded.

Work in this exact order once configs are published.

```
1. Bootstrap repo:
   - LICENSE  (MIT, copyright Mannes Brak, current year)
   - .gitignore  (node_modules, dist, coverage, *.log, .DS_Store)
   - package.json  (as specified in section 1)
   - eslint.config.js  (import and spread @mbtech-nl/eslint-config)
   - tsconfig.json  (extends @mbtech-nl/tsconfig/node, noEmit true)
   - tsconfig.build.json  (extends tsconfig.json, noEmit false, outDir dist)
   - vitest.config.ts  (as specified in section 14)
   - .github/FUNDING.yml
   - .github/workflows/ci.yml
   - .github/workflows/release.yml
   - empty src/index.ts
   - pnpm install — must complete without errors before proceeding

2. src/types.ts — all types, no logic

3. src/font/font8x8.ts — source the open-license 8×8 font data,
   record source and license in file header comment

4. src/encode.ts — createBitmap, bitmapEquals, bytesPerRow, getRow, iterRows
   Write tests. All pass.

5. src/font/render.ts — renderText, measureText
   Write tests. All pass.

6. src/dither.ts — floydSteinberg
   Write tests. All pass.

7. src/transform.ts — getPixel, setPixel, then all transform functions
   in order: rotateBitmap, flipHorizontal, flipVertical, invertBitmap,
   scaleBitmap, cropBitmap, stackBitmaps, padBitmap
   Write tests for each function immediately after implementing it.

8. src/image.ts — rgbaToLuminance, thresholdToBitmap, renderImage
   Write tests. All pass.

9. src/index.ts — wire up the barrel export

10. Run full test suite, verify coverage thresholds pass

11. Run build, verify dist/ output is correct

12. Write README.md

13. Verify ci.yml steps pass locally:
    pnpm typecheck && pnpm lint && prettier --check src && pnpm test:coverage && pnpm build
```

Do not proceed to step N+1 if tests for step N are failing.
Do not skip writing tests — they are part of each step, not optional.
