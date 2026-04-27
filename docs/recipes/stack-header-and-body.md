# Stack a header above a body bitmap

Compose a label out of pre-rendered pieces using [`stackBitmaps`](/api/functions/stackBitmaps). Vertical stacking requires every input to share the same `widthPx`; horizontal stacking requires every input to share the same `heightPx`.

```ts
import { padBitmap, renderImage, renderText, stackBitmaps } from '@mbtech-nl/bitmap';

const headerText = renderText('SHIPPING', { scaleX: 2, scaleY: 2 });
const bodyImage = renderImage(productPhotoRgba, { dither: 'atkinson' });

// Pad header so it matches the body's width.
const targetWidth = bodyImage.widthPx;
const leftPad = Math.floor((targetWidth - headerText.widthPx) / 2);
const rightPad = targetWidth - headerText.widthPx - leftPad;
const headerCentred = padBitmap(headerText, {
  top: 4,
  bottom: 6,
  left: Math.max(0, leftPad),
  right: Math.max(0, rightPad),
});

const label = stackBitmaps([headerCentred, bodyImage], 'vertical');
```

## Aligning widths

`stackBitmaps` throws `RangeError` if widths (vertical stack) or heights (horizontal stack) don't all match. Two ways to align them:

- **`padBitmap`** — wrap the smaller bitmap in white margins (above). Cheap; preserves content; keeps everything 1bpp.
- **`scaleBitmap`** — scale to a target *height*; width is computed from aspect ratio. Useful when one piece is intrinsically larger than the others, but resizing 1bpp content is noisy. Prefer pre-resize at the RGBA stage when possible.

## Three-way layout

Want a logo on the left, text in the middle, a barcode on the right? Build the middle column first (vertical stack), then horizontal-stack with the side pieces. Make sure all three columns share `heightPx` first — pad the shorter ones to match the tallest.

```ts
const left = renderImage(logoRgba, { dither: false });
const mid = stackBitmaps([titleText, addressText], 'vertical');
const right = renderImage(barcodeRgba, { dither: false });

const tallest = Math.max(left.heightPx, mid.heightPx, right.heightPx);
const align = (b: LabelBitmap) =>
  padBitmap(b, { bottom: tallest - b.heightPx });

const row = stackBitmaps([align(left), align(mid), align(right)], 'horizontal');
```
