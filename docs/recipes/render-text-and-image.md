# Render text and an image into one label

`renderText` and `renderImage` both return `LabelBitmap`s, so combining them is just a matter of stacking. The interesting part is sizing: text scales by integer factors (`scaleX`, `scaleY`), images scale by RGBA-stage resampling.

## Centred caption above an image

```ts
import { padBitmap, renderImage, renderText, stackBitmaps } from '@mbtech-nl/bitmap';

const image = renderImage(productPhotoRgba, { dither: 'atkinson' });
const caption = renderText('SKU 4501', { scaleX: 2, scaleY: 2 });

const padding = Math.max(0, image.widthPx - caption.widthPx);
const left = Math.floor(padding / 2);
const right = padding - left;

const captionCentred = padBitmap(caption, { top: 6, bottom: 4, left, right });
const label = stackBitmaps([captionCentred, image], 'vertical');
```

## Two-line text block

`renderText` does a single line — for multi-line, render each line separately and stack:

```ts
const lines = [
  renderText('TO:',                { scaleX: 1, scaleY: 1 }),
  renderText('Acme Corp',          { scaleX: 2, scaleY: 2 }),
  renderText('123 Main Street',    { scaleX: 1, scaleY: 1 }),
  renderText('Springfield, USA',   { scaleX: 1, scaleY: 1 }),
];

// All lines share the bundled font's char height (8) × scaleY, but widths
// differ — pad each to the widest one.
const targetWidth = Math.max(...lines.map(l => l.widthPx));
const padded = lines.map(l =>
  padBitmap(l, { right: targetWidth - l.widthPx, bottom: 2 }),
);
const block = stackBitmaps(padded, 'vertical');
```

## Inline text + image (horizontal)

```ts
import { padBitmap, renderImage, renderText, stackBitmaps } from '@mbtech-nl/bitmap';

const icon = renderImage(iconRgba, { dither: false });   // already small
const label = renderText('FRAGILE', { scaleX: 2, scaleY: 2 });

// Pad the shorter element to match the taller one.
const tallest = Math.max(icon.heightPx, label.heightPx);
const align = (b: LabelBitmap) =>
  b.heightPx === tallest ? b : padBitmap(b, { bottom: tallest - b.heightPx });

const row = stackBitmaps(
  [align(icon), padBitmap(align(label), { left: 8 })],
  'horizontal',
);
```

For text-rich layouts that don't fit the bundled 8×8 font, render the text in a real font using a canvas (browser or `@napi-rs/canvas`) and feed the result to `renderImage`.
