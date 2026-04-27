# Scale a logo to printer width

A common situation: you have a customer-supplied logo at some arbitrary resolution, and the printer wants exactly N pixels across (e.g. 384 dots for an 80mm head). You want the result to fill the printer's dot width while keeping aspect ratio.

The cleanest path is to do the resize **before** rasterisation — at the RGBA stage, with a real resampler — and then quantise the resized image. The lib's [`scaleBitmap`](/api/functions/scaleBitmap) is nearest-neighbour and operates on the 1bpp output, which is fine for emergencies but not what you want for a logo.

## Browser

```ts
import { renderImage } from '@mbtech-nl/bitmap';

async function logoToPrinterWidth(file: File, printerWidthPx: number) {
  const bitmap = await createImageBitmap(file);
  const aspect = bitmap.height / bitmap.width;
  const targetH = Math.round(printerWidthPx * aspect);

  const canvas = new OffscreenCanvas(printerWidthPx, targetH);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, printerWidthPx, targetH);
  const rgba = ctx.getImageData(0, 0, printerWidthPx, targetH);

  return renderImage(
    { width: rgba.width, height: rgba.height, data: new Uint8Array(rgba.data.buffer) },
    { dither: 'atkinson' },   // crisp for logos
  );
}
```

`createImageBitmap` + canvas resampling gives you bilinear-or-better quality for free, so the rasteriser only ever sees correctly-sized RGBA.

## Node

`@napi-rs/canvas` has the same `OffscreenCanvas`-style API and works with `renderImage` directly:

```ts
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import { renderImage } from '@mbtech-nl/bitmap';

async function logoToPrinterWidth(filepath: string, printerWidthPx: number) {
  const img = await loadImage(await readFile(filepath));
  const aspect = img.height / img.width;
  const targetH = Math.round(printerWidthPx * aspect);

  const canvas = createCanvas(printerWidthPx, targetH);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, printerWidthPx, targetH);
  const rgba = ctx.getImageData(0, 0, printerWidthPx, targetH);

  return renderImage(
    { width: rgba.width, height: rgba.height, data: new Uint8Array(rgba.data.buffer) },
    { dither: 'atkinson' },
  );
}
```

## When to use `scaleBitmap` instead

If the source is *already* a 1bpp `LabelBitmap` (e.g. you're enlarging a small QR code to fit a label), nearest-neighbour is exactly right — there's nothing to interpolate, and any smoothing would muddy the edges. That's what [`scaleBitmap`](/api/functions/scaleBitmap) is for:

```ts
import { scaleBitmap } from '@mbtech-nl/bitmap';
const bigQr = scaleBitmap(smallQr, 200);   // height: 200; width auto from aspect
```
