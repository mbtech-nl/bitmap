# @mbtech-nl/bitmap

[![Tests](https://github.com/mbtech-nl/bitmap/actions/workflows/ci.yml/badge.svg)](https://github.com/mbtech-nl/bitmap/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/mbtech-nl/bitmap/branch/main/graph/badge.svg)](https://codecov.io/gh/mbtech-nl/bitmap)
[![npm](https://img.shields.io/npm/v/@mbtech-nl/bitmap.svg)](https://www.npmjs.com/package/@mbtech-nl/bitmap)

Shared 1bpp bitmap rendering core for the MBTech thermal-label ecosystem. Powers `@thermal-label/labelmanager-ts`, `@thermal-label/labelwriter-ts`, `@thermal-label/brother-ql-ts`, `@labelkit/designer-core`. Pure TypeScript, zero runtime dependencies, no DOM APIs.

**📖 Full documentation: [mbtech-nl.github.io/bitmap](https://mbtech-nl.github.io/bitmap/)** — visual dither gallery, tone control demos, multi-plane walkthrough, interactive in-browser playground, full API reference.

## Install

```bash
pnpm add @mbtech-nl/bitmap
```

## Quick example

```ts
import { renderText, renderImage } from '@mbtech-nl/bitmap';

const textBitmap = renderText('HELLO', { scaleX: 2, scaleY: 2 });
const imageBitmap = renderImage(rawImageData, { dither: 'atkinson', rotate: 90 });
```

For multi-colour printers (Brother QL-800 with red/black tape, two-colour DYMO/Zebra), see [`renderMultiPlaneImage`](https://mbtech-nl.github.io/bitmap/guide/multi-plane).

## Choosing a dither method

| Content type | Recommended |
| --- | --- |
| Text, QR, barcodes, line drawings | `dither: false` (hard threshold) |
| Logos with sharp fills | `dither: false`, or `'atkinson'` if anti-aliased |
| Photos — smoothest gradient | `dither: 'jarvis-judice-ninke'` or `'stucki'` |
| Photos — crispest, most contrast | `dither: 'atkinson'` |
| Photos — balanced default | `dither: 'floyd-steinberg'` |
| Repeating patterns, posters, retro look | `dither: 'bayer4'` or `'bayer8'` |
| Speed-critical inner loop | `dither: 'bayer4'` (no error propagation) |

For side-by-side visuals of every method, see the [dithering guide](https://mbtech-nl.github.io/bitmap/guide/dithering).

## Also useful for…

Although built for thermal printers, the same primitives fit any pipeline that wants a clean 1bpp input:

- **OCR / document AI** — Tesseract and most classical OCR backends prefer binarised input. `renderImage` with `autoLevels: true` handles low-contrast scans; `dither: false` (hard threshold) preserves character edges.
- **Barcode / QR preprocessing** — same story; binarisation + nearest-neighbour scaling is exactly what decoders want.
- **Handwriting recognition / layout analysis** — feed normalised binary frames into downstream classical or ML models.
- **Multi-colour mask separation** — `renderMultiPlaneImage` produces mutually-exclusive masks per palette colour, useful as a deterministic colour-quantisation step before downstream processing.

Not a fit for general computer-vision preprocessing (CNNs, ViTs, CLIP) — those want full tonal range with bilinear/bicubic resampling, the opposite of what this lib produces. Reach for `torchvision`/`albumentations`/`PIL` there.

## API at a glance

- `renderText`, `measureText` — render ASCII into 1bpp using the bundled 8×8 font.
- `renderImage` — RGBA → 1bpp with threshold or one of six dither methods, plus `autoLevels`, `gamma`, `luminanceWeights`.
- `renderMultiPlaneImage` — RGBA → one 1bpp plane per palette entry, mutually exclusive (multi-colour printers).
- Transforms: `rotateBitmap`, `flipHorizontal`, `flipVertical`, `invertBitmap`, `scaleBitmap`, `cropBitmap`, `stackBitmaps`, `padBitmap`.
- Encoding helpers: `getRow`, `iterRows`, `bytesPerRow`, `createBitmap`, `bitmapEquals`, `getPixel`.

Full signatures with examples: [API reference](https://mbtech-nl.github.io/bitmap/api/).

## Bit layout

`LabelBitmap` stores pixels row-major and MSB-first:

- Byte index: `y * ceil(widthPx / 8) + floor(x / 8)`
- Bit index in byte: `7 - (x % 8)`
- Bit value: `1 = black`, `0 = white`

Trailing bits in the last byte of each row are always zeroed.

## Browser support

Pure TypeScript, zero runtime dependencies, no DOM APIs. Runs in modern browsers and Node.js where `Uint8Array` is available — including the [interactive playground](https://mbtech-nl.github.io/bitmap/guide/dithering#playground), which uses the same code that ships to npm.

## Font

Bundled `default8x8` uses IBM-derived CP437-compatible 8×8 glyphs for ASCII `0x20..0x7F`.
- Source: [dhepper/font8x8](https://github.com/dhepper/font8x8/blob/master/font8x8_basic.h)
- License: Public Domain

## Contributing

[mbtech-nl/.github/CONTRIBUTING.md](https://github.com/mbtech-nl/.github/blob/main/CONTRIBUTING.md)

## License

MIT
