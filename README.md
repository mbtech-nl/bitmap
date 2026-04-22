# @mbtech-nl/bitmap

[![Tests](https://github.com/mbtech-nl/bitmap/actions/workflows/ci.yml/badge.svg)](https://github.com/mbtech-nl/bitmap/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/mbtech-nl/bitmap/branch/main/graph/badge.svg)](https://codecov.io/gh/mbtech-nl/bitmap)

Shared 1bpp bitmap rendering core for the MBTech thermal-label ecosystem. This package powers printer drivers and design tooling across the org, including `@thermal-label/labelmanager-ts`, `@thermal-label/labelwriter-ts`, `@thermal-label/brother-ql-ts`, and `@labelkit/designer-core`.

## Install

```bash
pnpm add @mbtech-nl/bitmap
```

## Quick Example

```ts
import { renderText, renderImage } from '@mbtech-nl/bitmap';

const textBitmap = renderText('HELLO', { scaleX: 2, scaleY: 2 });
const imageBitmap = renderImage(rawImageData, { dither: true, rotate: 90 });
```

## API Reference

Typedoc: [https://github.com/mbtech-nl/bitmap](https://github.com/mbtech-nl/bitmap)

- `renderText(text, options)` - Render ASCII text into packed 1bpp bitmap data.
- `measureText(text, options)` - Compute rendered text dimensions without bitmap allocation.
- `renderImage(image, options)` - Convert RGBA image data to 1bpp bitmap with threshold/dither.
- `floydSteinberg(luminance, width, height, invert)` - Dither normalized luminance to packed 1bpp.
- `getPixel(bitmap, x, y)` - Read a black/white pixel from packed bitmap bytes.
- `rotateBitmap(bitmap, degrees)` - Rotate bitmap by 90, 180, or 270 clockwise.
- `flipHorizontal(bitmap)` - Mirror bitmap left-to-right.
- `flipVertical(bitmap)` - Mirror bitmap top-to-bottom.
- `invertBitmap(bitmap)` - Swap black and white pixels with trailing-bit masking.
- `scaleBitmap(bitmap, targetHeight)` - Resize bitmap by nearest-neighbor while preserving aspect ratio.
- `cropBitmap(bitmap, x, y, widthPx, heightPx)` - Extract a rectangular sub-region.
- `stackBitmaps(bitmaps, direction)` - Join bitmaps horizontally or vertically.
- `padBitmap(bitmap, padding)` - Add white margins around an existing bitmap.
- `getRow(bitmap, y)` - Copy one packed row for encoding/transport.
- `iterRows(bitmap)` - Iterate packed row views top-to-bottom.
- `bytesPerRow(widthPx)` - Return packed bytes per row (`ceil(widthPx / 8)`).
- `createBitmap(widthPx, heightPx)` - Allocate an empty white bitmap.
- `bitmapEquals(a, b)` - Compare dimensions and packed data equality.

## Bit Layout

`LabelBitmap` stores pixels row-major and MSB-first:

- Byte index: `y * ceil(widthPx / 8) + floor(x / 8)`
- Bit index in byte: `7 - (x % 8)`
- Bit value: `1 = black`, `0 = white`

Trailing bits in the last byte of each row are always zeroed.

## Font

The bundled `default8x8` font uses IBM-derived CP437-compatible 8x8 glyphs for ASCII `0x20..0x7F`.

- Source: [dhepper/font8x8](https://github.com/dhepper/font8x8/blob/master/font8x8_basic.h)
- License: Public Domain (as stated upstream, based on IBM public-domain VGA fonts)

## Browser Support

The package is pure TypeScript with zero runtime dependencies and no DOM APIs. It runs in modern browsers and Node.js environments where `Uint8Array` is available.

## Contributing

See the MBTech organization contributing guide:
[https://github.com/mbtech-nl/.github/blob/main/CONTRIBUTING.md](https://github.com/mbtech-nl/.github/blob/main/CONTRIBUTING.md)

## License

MIT
