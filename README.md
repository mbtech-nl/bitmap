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
const imageBitmap = renderImage(rawImageData, { dither: 'atkinson', rotate: 90 });
```

## `renderImage` options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `threshold` | `number` (0–255) | `128` | Hard-binarisation threshold. Ignored when `dither` is set. |
| `dither` | `boolean \| DitherMethod` | `false` | `false` = hard threshold. `true` = `'floyd-steinberg'` (v1.0 alias). Other values: `'atkinson'`, `'stucki'`, `'jarvis-judice-ninke'`, `'bayer4'`, `'bayer8'`. |
| `invert` | `boolean` | `false` | Swap black and white in the output. |
| `rotate` | `0 \| 90 \| 180 \| 270` | `0` | Rotate the rendered 1bpp bitmap. Applied last, after threshold/dither. |
| `autoLevels` | `boolean` | `false` | Stretch the luminance histogram so darkest input → 0 and brightest → 1, before gamma and threshold/dither. Best knob for an "auto-enhance" toggle. |
| `gamma` | `number` (>0) | `1` | Pow-curve correction on luminance: `< 1` brightens midtones, `> 1` darkens. Per-printer darkness calibration knob. |
| `luminanceWeights` | `'bt709' \| 'bt601' \| [r,g,b]` | `'bt709'` | RGB-to-grey weights. Tuples must be non-negative and sum to ~1. |

### Pipeline order

Inside `renderImage` the steps run in this fixed order; each is optional:

```
rgba → luminance(weights) → autoLevels → gamma → threshold | dither → rotate
```

`autoLevels` runs before `gamma` so contrast is restored before tone-mapping; `rotate` is applied at the end on the 1bpp output.

### When to use what

| Content type | Recommended |
| --- | --- |
| Text, QR, barcodes, line drawings | `dither: false` (hard threshold) |
| Logos with sharp fills | `dither: false`, or `'atkinson'` if anti-aliased |
| Photos — smoothest gradient | `dither: 'jarvis-judice-ninke'` or `'stucki'` |
| Photos — crispest, most contrast | `dither: 'atkinson'` |
| Photos — balanced default | `dither: 'floyd-steinberg'` (or `dither: true`) |
| Repeating patterns, posters, retro look | `dither: 'bayer4'` or `'bayer8'` |
| Speed-critical inner loop | `dither: 'bayer4'` (no error propagation) |

`gamma` is for per-printer darkness calibration (set once per printer model). `autoLevels` is for low-contrast scanned/photographed input. `luminanceWeights: 'bt601'` only matches legacy NTSC tools; weights tuples are a niche power-user knob (e.g. `[1, 0, 0]` to read only the red channel).

## API Reference

Typedoc: [https://github.com/mbtech-nl/bitmap](https://github.com/mbtech-nl/bitmap)

- `renderText(text, options)` - Render ASCII text into packed 1bpp bitmap data.
- `measureText(text, options)` - Compute rendered text dimensions without bitmap allocation.
- `renderImage(image, options)` - Convert RGBA image data to 1bpp bitmap with threshold/dither.
- `floydSteinberg(luminance, width, height, invert)` - Dither normalized luminance to packed 1bpp. Kept for v1.0 compatibility; new code should pass `dither: 'floyd-steinberg'` to `renderImage` instead.
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
