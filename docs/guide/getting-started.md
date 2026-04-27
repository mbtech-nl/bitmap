# Getting started

`@mbtech-nl/bitmap` is the shared 1bpp bitmap rendering core for the MBTech thermal-label ecosystem. It powers printer drivers and design tooling across the org, including `@thermal-label/labelmanager-ts`, `@thermal-label/labelwriter-ts`, `@thermal-label/brother-ql-ts`, and `@labelkit/designer-core`.

## Install

```bash
pnpm add @mbtech-nl/bitmap
```

The package is pure TypeScript with zero runtime dependencies and no DOM APIs. It runs in modern browsers and Node.js environments where `Uint8Array` is available.

## Quick example

```ts
import { renderText, renderImage } from '@mbtech-nl/bitmap';

const textBitmap = renderText('HELLO', { scaleX: 2, scaleY: 2 });
const imageBitmap = renderImage(rawImageData, { dither: 'atkinson', rotate: 90 });
```

`renderText` returns a packed 1bpp `LabelBitmap` from the bundled IBM-derived 8×8 font. `renderImage` takes RGBA pixel data and produces a 1bpp bitmap using either a hard threshold or one of six dither methods.

## What to read next

- **[Dithering](./dithering.md)** — visual gallery of every dither method on multiple source images, plus a decision matrix for choosing one.
- **[Tone & luminance](./tone-and-luminance.md)** — `autoLevels`, `gamma`, and `luminanceWeights` controls.
- **[Multi-plane output](./multi-plane.md)** — render to multiple ink colours for printers that can place more than one foil.
- **[Pipeline order](./pipeline.md)** — the fixed order of transforms inside `renderImage` and why.
- **[API reference](/api/)** — every public export with its signature, parameters, and examples.

## Bit layout

`LabelBitmap` stores pixels row-major and MSB-first:

- Byte index: `y * ceil(widthPx / 8) + floor(x / 8)`
- Bit index in byte: `7 - (x % 8)`
- Bit value: `1 = black`, `0 = white`

Trailing bits in the last byte of each row are always zeroed.

## Browser support

The package is pure TypeScript with zero runtime dependencies and no DOM APIs. It runs in modern browsers and Node.js environments where `Uint8Array` is available — including the interactive playgrounds on this site, which import the same code that ships to npm.

## Contributing

See the MBTech organization contributing guide:
[mbtech-nl/.github/CONTRIBUTING.md](https://github.com/mbtech-nl/.github/blob/main/CONTRIBUTING.md)
