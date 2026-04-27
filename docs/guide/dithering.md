# Dithering

`renderImage` quantises each pixel to either black (`1`) or white (`0`). For text and line art a hard threshold is usually best — every pixel ends up where the source put it. For photographs and other continuous-tone input, a hard threshold collapses gradients into solid blobs; a *dither* method scatters the quantisation error across nearby pixels so the printed average roughly matches the input greyscale.

This page renders the same source image through every available method so you can pick by eye. For an at-a-glance cheat sheet, jump to [§ When to use what](#when-to-use-what).

## How to choose one

Pass a `dither` option to `renderImage`:

```ts
renderImage(rgba, { dither: 'atkinson' });   // named method
renderImage(rgba, { dither: false });        // hard threshold (default)
renderImage(rgba, { dither: true });         // alias for 'floyd-steinberg'
```

Available methods: `'floyd-steinberg'`, `'atkinson'`, `'stucki'`, `'jarvis-judice-ninke'`, `'bayer4'`, `'bayer8'`. The `boolean` form exists for v1.0 compatibility.

## Logo (sharp two-tone)

Logos and icons usually want **hard threshold** — every method other than `false` introduces speckle on the solid fills.

<DitherGallery
  :tiles="[
    { label: 'source', src: '/images/dithering/logo/source.png' },
    { label: 'threshold', src: '/images/dithering/logo/threshold.png' },
    { label: 'floyd-steinberg', src: '/images/dithering/logo/floyd-steinberg.png' },
    { label: 'atkinson', src: '/images/dithering/logo/atkinson.png' },
    { label: 'stucki', src: '/images/dithering/logo/stucki.png' },
    { label: 'jarvis-judice-ninke', src: '/images/dithering/logo/jarvis-judice-ninke.png' },
    { label: 'bayer4', src: '/images/dithering/logo/bayer4.png' },
    { label: 'bayer8', src: '/images/dithering/logo/bayer8.png' },
  ]"
/>

## Line art

Thin strokes and dots break up under any error-diffusion method. Hard threshold preserves them; ordered (Bayer) methods leave them mostly intact but add a uniform texture to the background.

<DitherGallery
  :tiles="[
    { label: 'source', src: '/images/dithering/line-art/source.png' },
    { label: 'threshold', src: '/images/dithering/line-art/threshold.png' },
    { label: 'floyd-steinberg', src: '/images/dithering/line-art/floyd-steinberg.png' },
    { label: 'atkinson', src: '/images/dithering/line-art/atkinson.png' },
    { label: 'stucki', src: '/images/dithering/line-art/stucki.png' },
    { label: 'jarvis-judice-ninke', src: '/images/dithering/line-art/jarvis-judice-ninke.png' },
    { label: 'bayer4', src: '/images/dithering/line-art/bayer4.png' },
    { label: 'bayer8', src: '/images/dithering/line-art/bayer8.png' },
  ]"
/>

## Photograph

This is where the dither methods earn their keep. Hard threshold collapses the sky into a single solid; Bayer adds a strong checkerboard pattern that some people find period-appropriate; the error-diffusion family produces the most "photographic" output, with subtle differences:

- **Floyd–Steinberg** — the workhorse default. Slightly directional artefacts on smooth areas.
- **Atkinson** — only diffuses 6/8 of the error, dropping the rest. Higher-contrast result; cleaner edges; can look "punchy" on faces.
- **Stucki / JJN** — bigger kernels, smoother gradients, slightly slower.

<DitherGallery
  :tiles="[
    { label: 'source', src: '/images/dithering/photo/source.png' },
    { label: 'threshold', src: '/images/dithering/photo/threshold.png' },
    { label: 'floyd-steinberg', src: '/images/dithering/photo/floyd-steinberg.png' },
    { label: 'atkinson', src: '/images/dithering/photo/atkinson.png' },
    { label: 'stucki', src: '/images/dithering/photo/stucki.png' },
    { label: 'jarvis-judice-ninke', src: '/images/dithering/photo/jarvis-judice-ninke.png' },
    { label: 'bayer4', src: '/images/dithering/photo/bayer4.png' },
    { label: 'bayer8', src: '/images/dithering/photo/bayer8.png' },
  ]"
/>

## When to use what

| Content type | Recommended |
| --- | --- |
| Text, QR, barcodes, line drawings | `dither: false` (hard threshold) |
| Logos with sharp fills | `dither: false`, or `'atkinson'` if anti-aliased |
| Photos — smoothest gradient | `dither: 'jarvis-judice-ninke'` or `'stucki'` |
| Photos — crispest, most contrast | `dither: 'atkinson'` |
| Photos — balanced default | `dither: 'floyd-steinberg'` (or `dither: true`) |
| Repeating patterns, posters, retro look | `dither: 'bayer4'` or `'bayer8'` |
| Speed-critical inner loop | `dither: 'bayer4'` (no error propagation) |

## Performance notes

Error-diffusion methods (`floyd-steinberg`, `atkinson`, `stucki`, `jarvis-judice-ninke`) walk every pixel and update its neighbours, so cost scales with image size and kernel width. Bayer methods (`bayer4`, `bayer8`) are simple table lookups and are by far the fastest — appropriate when you're rendering many small bitmaps in a tight loop.

For threshold output, see also the `threshold` option (default `128`) — useful when source images aren't centred around mid-grey.

## Playground

<Playground />
