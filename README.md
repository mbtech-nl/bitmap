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

For multi-colour printers (Brother QL-800 with red/black tape, two-colour DYMO/Zebra models), see [`renderMultiPlaneImage`](#multi-plane-output) below.

## Multi-plane output

Some thermal printers can place more than one ink/foil colour on a label — e.g. a Brother QL-800 with DK-22251 red/black tape, or two-colour DYMO/Zebra models. `renderMultiPlaneImage` accepts a caller-supplied palette of N entries and returns one independent 1bpp `LabelBitmap` per palette entry, keyed by entry name. Output planes are guaranteed mutually exclusive: at every pixel position, at most one plane has its bit set, because most multi-colour thermal heads cannot fire two colours on the same dot.

```ts
import { renderMultiPlaneImage } from '@mbtech-nl/bitmap';

// Brother QL-800 with DK-22251 red/black tape.
const { black, red } = renderMultiPlaneImage(image, {
  palette: [
    { name: 'black', rgb: [0, 0, 0] },
    { name: 'red', rgb: [204, 0, 0] },
  ],
  defaults: { dither: 'floyd-steinberg' },
  planes: {
    // Red foil prints a touch lighter on this printer — calibrate.
    red: { gamma: 1.15 },
  },
  rotate: 90,
});

// `black` and `red` are independent LabelBitmaps. Driver-side, they go
// into the printer's two-colour wire format (this package doesn't do
// hardware-specific framing).
```

### How classification works

Each source pixel is classified to exactly one palette entry, or to the implicit white substrate background. Classification picks the *closest* palette colour by Euclidean distance in RGB (default) or CIELAB ΔE76 (`colorSpace: 'lab'`). Pixels closer to white than to any palette entry land on the implicit background and produce no ink in any plane.

For each classified pixel, an *intensity* in [0, 1] is computed from how close the pixel sits to its assigned palette colour relative to that entry's Voronoi half-width (the half-distance to its nearest other palette entry, including white). Pure palette colour → intensity 1.0 → maximum ink density. Boundary pixels → intensity ~0.0 → no ink. Anti-aliased edges therefore fade out naturally toward the boundary.

This means intensity measures **colour-closeness, not darkness**. The classifier is well-suited to designed assets, line art, anti-aliased text, and logos. For photo-like input with dark off-palette colours, the resulting plane will look weak — pre-process with a colour-quantisation step first.

### Per-plane options

`MultiPlaneRenderOptions.defaults` applies to every plane unless overridden in `planes[name]`. Per-plane override fields:

| Field | Same meaning as in `renderImage`? |
| --- | --- |
| `threshold` | Yes |
| `dither` | Yes |
| `autoLevels` | Yes (per plane; see note below) |
| `gamma` | Yes |

Notably, `invert` is **not** available on `PlaneRenderOptions`. Inverting an individual plane would set bits on every background and other-plane pixel, breaking the mutual-exclusivity guarantee. If you need an inverted plane, call `invertBitmap(planes.foo)` on the result.

`autoLevels` per plane runs over the plane's full buffer; because background pixels are pinned to luminance 1.0, only the foreground's `min` drives the stretch. Net effect: each plane stretches its foreground to use the full [0, 1] range relative to its own substrate-white reference.

`rotate` is a top-level option (not per-plane) — independent rotation makes no physical sense for a multi-colour print.

### Validation

`renderMultiPlaneImage` throws `RangeError` on:

- empty palette, or > 254 entries
- duplicate plane names, or duplicate `rgb` tuples
- name `'white'` (reserved for the implicit background)
- `rgb` outside `[0, 255]` or non-integer
- `rgb` exactly `[255, 255, 255]` (collides with implicit white)
- zero-dimension image, or `data.length` mismatch

### Choosing `colorSpace`

- `'rgb'` (default): fast Euclidean argmin in 0–255 RGB. Fine for designed assets where palette colours are clearly separated.
- `'lab'`: convert sRGB → linear → XYZ → CIELAB (D65 white) and pick by ΔE76. Use when palette colours are perceptually close (e.g. two near-identical reds) and you need the visually-correct partition.

For typical two-colour printers (red+black, blue+black, gold+black) RGB is fine. For three+ colour palettes with similar hues, switch to `'lab'`.

## API Reference

Typedoc: [https://github.com/mbtech-nl/bitmap](https://github.com/mbtech-nl/bitmap)

- `renderText(text, options)` - Render ASCII text into packed 1bpp bitmap data.
- `measureText(text, options)` - Compute rendered text dimensions without bitmap allocation.
- `renderImage(image, options)` - Convert RGBA image data to 1bpp bitmap with threshold/dither.
- `renderMultiPlaneImage(image, options)` - Convert RGBA image data to one 1bpp bitmap per palette entry, mutually exclusive. See [Multi-plane output](#multi-plane-output).
- `floydSteinberg(luminance, width, height, invert, mask?)` - Dither normalized luminance to packed 1bpp. Kept for v1.0 compatibility; new code should pass `dither: 'floyd-steinberg'` to `renderImage` instead. The optional `mask` argument is used internally by `renderMultiPlaneImage` to keep error diffusion within a plane's classified region.
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
