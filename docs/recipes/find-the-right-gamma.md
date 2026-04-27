# Find the right gamma

`gamma` is the per-printer darkness-calibration knob. Different thermal heads, different tape stocks, different ambient temperatures — they all shift how dark a given bitmap actually prints. `gamma` lets you compensate without re-rendering source artwork.

This recipe is the empirical procedure for picking a value.

## What gamma does

`gamma` is a pow-curve applied to luminance *after* `autoLevels` and *before* threshold/dither:

- `gamma < 1` brightens midtones — use when the printer comes out too dark.
- `gamma > 1` darkens midtones — use when the printer comes out too light.
- `gamma === 1` is a no-op (the default).

Pure black input pixels stay black at every gamma; pure white stays white. Only the midtones shift.

## Procedure

1. **Generate a gamma sweep test card.** Print the same source image at five gamma values — `0.7`, `0.85`, `1.0`, `1.15`, `1.3` — using a representative dither method (`'floyd-steinberg'` is fine).

   ```ts
   import { padBitmap, renderImage, stackBitmaps } from '@mbtech-nl/bitmap';

   const sweep = [0.7, 0.85, 1.0, 1.15, 1.3].map((g) =>
     padBitmap(
       renderImage(testRgba, { dither: 'floyd-steinberg', gamma: g }),
       { bottom: 8 },
     ),
   );
   const card = stackBitmaps(sweep, 'vertical');
   await printer.send(card);
   ```

2. **Print on the actual stock.** Don't calibrate against your screen, against a different printer, or against a different tape — gamma is per-printer-per-tape.

3. **Pick by eye.** Look for the panel where:
   - Solid blacks are dense but not bleeding.
   - Light greys (skies, faces, gradient highlights) are visible but not muddy.
   - You can still read fine text and thin lines.

4. **Bake the chosen value into your driver's defaults.** Don't make end-users tune this — they shouldn't have to.

   ```ts
   const PRINTER_GAMMA = 0.85;
   renderImage(rgba, { dither: 'floyd-steinberg', gamma: PRINTER_GAMMA });
   ```

## Per-tape adjustments

Some printers (Brother QL with DK-22251, two-colour DYMO) print red/blue foils with a different effective darkness from black. For those, calibrate gamma per plane via [`renderMultiPlaneImage`](/api/functions/renderMultiPlaneImage)'s `planes[name].gamma` override:

```ts
renderMultiPlaneImage(image, {
  palette: [
    { name: 'black', rgb: [0, 0, 0] },
    { name: 'red', rgb: [204, 0, 0] },
  ],
  defaults: { dither: 'floyd-steinberg' },
  planes: {
    red: { gamma: 1.15 },     // red foil burns lighter on this printer
  },
});
```

## When to use `autoLevels` instead

If you're calibrating to compensate for *low-contrast input* (faded scans, washed-out photos), you want [`autoLevels`](/guide/tone-and-luminance#autolevels-fix-flat-scans), not `gamma`. `autoLevels` rescales the input range; `gamma` reshapes midtones. They compose — and `autoLevels` runs first in the pipeline, so a typical "auto-enhance" config sets both:

```ts
renderImage(rgba, {
  dither: 'floyd-steinberg',
  autoLevels: true,
  gamma: PRINTER_GAMMA,
});
```
