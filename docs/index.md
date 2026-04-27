---
layout: home

hero:
  name: '@mbtech-nl/bitmap'
  text: 1bpp bitmaps for thermal printers
  tagline: Dithering, multi-plane colour, transforms — zero runtime dependencies, browser-clean.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Try it in the browser
      link: /guide/dithering#playground
    - theme: alt
      text: View on GitHub
      link: https://github.com/mbtech-nl/bitmap

features:
  - title: Six dither methods + threshold
    details: Floyd–Steinberg, Atkinson, Stucki, Jarvis–Judice–Ninke, Bayer 4×4 / 8×8, plus hard threshold. Visual gallery shows each side-by-side.
    link: /guide/dithering
    linkText: See gallery
  - title: Multi-plane colour
    details: Render to one 1bpp bitmap per palette entry (Brother QL-800 red+black, two-colour DYMO/Zebra). Mutually-exclusive output guaranteed.
    link: /guide/multi-plane
    linkText: How it works
  - title: Tone controls
    details: autoLevels for low-contrast scans, gamma for per-printer darkness calibration, custom luminance weights for unusual sources.
    link: /guide/tone-and-luminance
    linkText: Tune output
  - title: Pure TypeScript, zero deps
    details: No DOM APIs, no runtime dependencies. Runs in modern browsers and Node.js. The interactive playground on this site uses the same code that ships to npm.
    link: /guide/getting-started
    linkText: Install
---
