/**
 * Regenerates every PNG in docs/public/images from procedural fixtures
 * and the lib's actual exports. Run via `pnpm docs:images`.
 *
 * Determinism: PNGs are written with a fixed deflate level and no tIME /
 * tEXt / pHYs / gAMA chunks, so byte-equal output is reproducible across
 * dev and CI machines (Linux / macOS / Windows). The CI guard
 * `pnpm docs:check-images` runs this script and fails if `git diff`
 * reports any change — which means a behaviour change in the lib or a
 * deliberate fixture tweak forces a docs-image refresh in the same PR.
 *
 * No external image files are committed; sources are generated here.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

import {
  type LabelBitmap,
  type MultiPlaneRenderOptions,
  type PaletteEntry,
  type RawImageData,
  renderImage,
  renderMultiPlaneImage,
  renderText,
} from '../dist/index.js';
import { rgbaToLuminance } from '../dist/image.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT = resolve(ROOT, 'docs/public/images');

// -----------------------------------------------------------------------------
// Procedural source generation
// -----------------------------------------------------------------------------

interface RGBA {
  width: number;
  height: number;
  data: Uint8Array;
}

function blankRgba(width: number, height: number, fill: [number, number, number] = [255, 255, 255]): RGBA {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function setPx(img: RGBA, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  // Floor coordinates: typed-array property writes with float keys silently
  // no-op (Uint8Array[1.5] = 5 doesn't write to the buffer). Without this,
  // any caller passing a non-integer x or y silently drops the pixel.
  x = x | 0;
  y = y | 0;
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const idx = (y * img.width + x) * 4;
  img.data[idx] = r | 0;
  img.data[idx + 1] = g | 0;
  img.data[idx + 2] = b | 0;
  img.data[idx + 3] = a;
}

function getPx(img: RGBA, x: number, y: number): [number, number, number] {
  const idx = (y * img.width + x) * 4;
  return [img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!];
}

function blendPx(
  img: RGBA,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
): void {
  x = x | 0;
  y = y | 0;
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const a = Math.max(0, Math.min(1, alpha));
  const idx = (y * img.width + x) * 4;
  img.data[idx] = Math.round(img.data[idx]! * (1 - a) + r * a);
  img.data[idx + 1] = Math.round(img.data[idx + 1]! * (1 - a) + g * a);
  img.data[idx + 2] = Math.round(img.data[idx + 2]! * (1 - a) + b * a);
  img.data[idx + 3] = 255;
}

function fillRect(img: RGBA, x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      setPx(img, px, py, r, g, b);
    }
  }
}

function filledCircle(img: RGBA, cx: number, cy: number, radius: number, r: number, g: number, b: number): void {
  const rSq = radius * radius;
  for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy += 1) {
    for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx += 1) {
      const distSq = dx * dx + dy * dy;
      if (distSq <= rSq) {
        // Anti-alias the edge softly
        const dist = Math.sqrt(distSq);
        const alpha = Math.max(0, Math.min(1, radius - dist));
        blendPx(img, cx + dx, cy + dy, r, g, b, alpha);
      }
    }
  }
}

function strokeCircle(img: RGBA, cx: number, cy: number, radius: number, lineWidth: number, r: number, g: number, b: number): void {
  const inner = radius - lineWidth / 2;
  const outer = radius + lineWidth / 2;
  for (let dy = -Math.ceil(outer); dy <= Math.ceil(outer); dy += 1) {
    for (let dx = -Math.ceil(outer); dx <= Math.ceil(outer); dx += 1) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= inner - 0.5 && dist <= outer + 0.5) {
        const alpha = Math.max(0, Math.min(1, Math.min(outer - dist, dist - inner) + 0.5));
        blendPx(img, cx + dx, cy + dy, r, g, b, alpha);
      }
    }
  }
}

function strokeLine(img: RGBA, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number): void {
  // Wu-ish anti-aliased line.
  const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
  if (steep) {
    [x0, y0] = [y0, x0];
    [x1, y1] = [y1, x1];
  }
  if (x0 > x1) {
    [x0, x1] = [x1, x0];
    [y0, y1] = [y1, y0];
  }
  const dx = x1 - x0;
  const dy = y1 - y0;
  const grad = dx === 0 ? 1 : dy / dx;
  let yf = y0;
  for (let x = Math.round(x0); x <= Math.round(x1); x += 1) {
    const yi = Math.floor(yf);
    const f = yf - yi;
    if (steep) {
      blendPx(img, yi, x, r, g, b, 1 - f);
      blendPx(img, yi + 1, x, r, g, b, f);
    } else {
      blendPx(img, x, yi, r, g, b, 1 - f);
      blendPx(img, x, yi + 1, r, g, b, f);
    }
    yf += grad;
  }
}

// Tiny xorshift PRNG for reproducible noise.
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 0xffffffff) / 0xffffffff;
  };
}

// -----------------------------------------------------------------------------
// Fixture generation
// -----------------------------------------------------------------------------

function makeLogo(width = 240, height = 150): RGBA {
  const img = blankRgba(width, height);
  const cx = (width / 2) | 0;
  const cy = 44;

  // Hexagonal frame around the badge
  const hexR = 32;
  const hexPoints: [number, number][] = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    hexPoints.push([cx + Math.cos(a) * hexR, cy + Math.sin(a) * hexR]);
  }
  for (let i = 0; i < 6; i += 1) {
    const [x0, y0] = hexPoints[i]!;
    const [x1, y1] = hexPoints[(i + 1) % 6]!;
    strokeLine(img, x0, y0, x1, y1, 0, 0, 0);
    strokeLine(img, x0, y0 + 1, x1, y1 + 1, 0, 0, 0);
  }

  // Inner stripe band — diagonal hatch inside a smaller hex region
  for (let y = cy - 14; y < cy + 14; y += 1) {
    const halfW = 18;
    for (let x = cx - halfW; x < cx + halfW; x += 1) {
      if ((x + y) % 4 === 0) setPx(img, x, y, 0, 0, 0);
    }
  }

  // Donut focal point inside
  filledCircle(img, cx + 7, cy, 10, 0, 0, 0);
  filledCircle(img, cx + 7, cy, 5, 255, 255, 255);

  // Three small chevrons at the bottom of the badge
  for (let i = 0; i < 3; i += 1) {
    const ox = cx - 12 + i * 12;
    const oy = cy + 18;
    strokeLine(img, ox, oy, ox + 4, oy + 4, 0, 0, 0);
    strokeLine(img, ox + 8, oy, ox + 4, oy + 4, 0, 0, 0);
  }

  // Wordmark
  const wordmark = renderText('BITMAP', { scaleX: 2, scaleY: 2 });
  const wx = ((width - wordmark.widthPx) / 2) | 0;
  const wy = cy + hexR + 12;
  drawBitmap(img, wordmark, wx, wy, [0, 0, 0]);

  // Tagline
  const tag = renderText('1bpp rendering', { scaleX: 1, scaleY: 1 });
  const tagx = ((width - tag.widthPx) / 2) | 0;
  const tagy = wy + wordmark.heightPx + 4;
  drawBitmap(img, tag, tagx, tagy, [0, 0, 0]);

  return img;
}

function makeLineArt(width = 240, height = 180): RGBA {
  const img = blankRgba(width, height);
  // Concentric circles
  const cx = width / 2;
  const cy = height / 2;
  for (let r = 10; r < Math.min(width, height) / 2; r += 18) {
    strokeCircle(img, cx | 0, cy | 0, r, 1.2, 0, 0, 0);
  }
  // Diagonal hatch top-left to bottom-right
  for (let i = -height; i < width; i += 6) {
    strokeLine(img, i, 0, i + height, height, 0, 0, 0);
  }
  // Vertical/horizontal grid in a corner
  for (let x = 8; x < 80; x += 4) strokeLine(img, x, 8, x, 80, 0, 0, 0);
  for (let y = 8; y < 80; y += 4) strokeLine(img, 8, y, 80, y, 0, 0, 0);
  return img;
}

function makePhoto(width = 240, height = 180): RGBA {
  // Synthetic "photo": gradient sky + sun + horizon + textured ground.
  const img = blankRgba(width, height);
  const rng = prng(0xc0ffee);
  const horizon = (height * 0.55) | 0;

  // Sky: vertical gradient (top: light blue-grey, horizon: pale yellow-grey).
  for (let y = 0; y < horizon; y += 1) {
    const t = y / horizon;
    const r = 220 - 110 * (1 - t) ** 2;
    const g = 230 - 80 * (1 - t) ** 2;
    const b = 245 - 30 * t;
    for (let x = 0; x < width; x += 1) {
      const noise = (rng() - 0.5) * 8;
      setPx(img, x, y, r + noise, g + noise, b + noise);
    }
  }

  // Sun
  const sunX = (width * 0.7) | 0;
  const sunY = (horizon - 28) | 0;
  for (let dy = -36; dy <= 36; dy += 1) {
    for (let dx = -36; dx <= 36; dx += 1) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 36) {
        const intensity = Math.max(0, 1 - d / 36);
        blendPx(img, sunX + dx, sunY + dy, 255, 240, 200, intensity * 0.9);
      }
    }
  }

  // Ground: horizontal bands of varying darkness (rolling hills)
  for (let y = horizon; y < height; y += 1) {
    const t = (y - horizon) / (height - horizon);
    const wave = Math.sin(y * 0.3) * 12 + Math.sin(y * 0.07) * 30;
    const base = 100 - 50 * t + wave * 0.2;
    for (let x = 0; x < width; x += 1) {
      const xWave = Math.sin(x * 0.05 + y * 0.02) * 18;
      const noise = (rng() - 0.5) * 14;
      const v = base + xWave + noise;
      setPx(img, x, y, v * 0.9, v, v * 0.7);
    }
  }

  // A few distant trees
  for (let i = 0; i < 8; i += 1) {
    const tx = ((rng() * 0.9 + 0.05) * width) | 0;
    const th = (8 + rng() * 18) | 0;
    const ty = horizon - th;
    fillRect(img, tx, ty, 2, th, 60, 70, 50);
    filledCircle(img, tx + 1, ty - 2, 4 + rng() * 2, 50, 80, 40);
  }

  return img;
}

function makeLowContrastScan(width = 240, height = 180): RGBA {
  // Same photo, but compressed into [80, 160] tonal range.
  const photo = makePhoto(width, height);
  for (let i = 0; i < photo.width * photo.height; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const v = photo.data[i * 4 + c]!;
      photo.data[i * 4 + c] = 80 + Math.round((v / 255) * 80);
    }
  }
  return photo;
}

function makeMultiColourDesign(width = 240, height = 180): RGBA {
  // Designed for the realistic Brother QL-800 [black, red] palette: red sun,
  // black mountain silhouettes, black tree silhouettes, red wordmark. No blue
  // — palette colours match source content exactly so both planes render
  // cleanly. Demonstrates "designed asset for a real two-colour printer."
  const img = blankRgba(width, height);

  // Red sun in the upper-left
  filledCircle(img, 50, 52, 24, 204, 0, 0);

  // Three black triangular mountain silhouettes across the lower half.
  const mountains: { peakX: number; peakY: number; baseW: number }[] = [
    { peakX: 40, peakY: 100, baseW: 80 },
    { peakX: 120, peakY: 70, baseW: 110 },
    { peakX: 195, peakY: 90, baseW: 90 },
  ];
  for (const m of mountains) {
    const baseY = height - 10;
    for (let y = m.peakY; y < baseY; y += 1) {
      const t = (y - m.peakY) / (baseY - m.peakY);
      const halfW = (t * m.baseW) / 2;
      for (let x = m.peakX - halfW; x < m.peakX + halfW; x += 1) {
        setPx(img, x, y, 0, 0, 0);
      }
    }
  }

  // Two black tree silhouettes in the foreground (trunk + triangular crown)
  const trees: { cx: number; baseY: number; treeHeight: number }[] = [
    { cx: 80, baseY: height - 10, treeHeight: 32 },
    { cx: 165, baseY: height - 10, treeHeight: 24 },
  ];
  for (const tree of trees) {
    // Trunk
    fillRect(img, tree.cx - 1, tree.baseY - 5, 3, 5, 0, 0, 0);
    // Crown — overlapping circles for a soft pine shape
    filledCircle(img, tree.cx, tree.baseY - tree.treeHeight, 6, 0, 0, 0);
    filledCircle(img, tree.cx - 3, tree.baseY - tree.treeHeight + 7, 7, 0, 0, 0);
    filledCircle(img, tree.cx + 3, tree.baseY - tree.treeHeight + 7, 7, 0, 0, 0);
    filledCircle(img, tree.cx, tree.baseY - tree.treeHeight + 14, 8, 0, 0, 0);
  }

  // Red SUN wordmark in the upper-right
  const txt = renderText('SUN', { scaleX: 2, scaleY: 2 });
  drawBitmap(img, txt, width - txt.widthPx - 12, 14, [204, 0, 0]);

  // Thin red horizontal accent below the wordmark
  fillRect(img, width - txt.widthPx - 12, 14 + txt.heightPx + 3, txt.widthPx, 2, 204, 0, 0);

  return img;
}

// -----------------------------------------------------------------------------
// Helpers: stamp a rendered LabelBitmap onto an RGBA canvas
// -----------------------------------------------------------------------------

function drawBitmap(
  img: RGBA,
  bmp: LabelBitmap,
  ox: number,
  oy: number,
  rgb: [number, number, number],
): void {
  const rowBytes = Math.ceil(bmp.widthPx / 8);
  for (let y = 0; y < bmp.heightPx; y += 1) {
    for (let x = 0; x < bmp.widthPx; x += 1) {
      const byte = bmp.data[y * rowBytes + Math.floor(x / 8)]!;
      const on = (byte >> (7 - (x % 8))) & 1;
      if (on) setPx(img, ox + x, oy + y, rgb[0], rgb[1], rgb[2]);
    }
  }
}

// -----------------------------------------------------------------------------
// 1bpp -> RGBA renderer (for output PNGs)
// -----------------------------------------------------------------------------

function bitmapToRgba(bmp: LabelBitmap, ink: [number, number, number] = [0, 0, 0], bg: [number, number, number] = [255, 255, 255]): RGBA {
  const out = blankRgba(bmp.widthPx, bmp.heightPx, bg);
  drawBitmap(out, bmp, 0, 0, ink);
  return out;
}

// -----------------------------------------------------------------------------
// Multi-plane composite + classification map
// -----------------------------------------------------------------------------

function compositeMultiPlane(
  width: number,
  height: number,
  planes: Record<string, LabelBitmap>,
  palette: readonly PaletteEntry[],
): RGBA {
  const out = blankRgba(width, height);
  for (const entry of palette) {
    const bmp = planes[entry.name]!;
    drawBitmap(out, bmp, 0, 0, [entry.rgb[0], entry.rgb[1], entry.rgb[2]]);
  }
  return out;
}

function classificationMap(
  source: RawImageData,
  palette: readonly PaletteEntry[],
  colorSpace: 'rgb' | 'lab' = 'rgb',
): RGBA {
  // Mirror the same classification renderMultiPlaneImage performs internally,
  // but render the result as coloured pixels instead of separate planes.
  const out = blankRgba(source.width, source.height);
  const whiteRgb: [number, number, number] = [255, 255, 255];
  for (let i = 0; i < source.width * source.height; i += 1) {
    const r = source.data[i * 4]!;
    const g = source.data[i * 4 + 1]!;
    const b = source.data[i * 4 + 2]!;
    let bestIdx = -1;
    let bestDist = distance([r, g, b], whiteRgb, colorSpace);
    for (let p = 0; p < palette.length; p += 1) {
      const entry = palette[p]!;
      const d = distance([r, g, b], [entry.rgb[0], entry.rgb[1], entry.rgb[2]], colorSpace);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = p;
      }
    }
    const px = i % source.width;
    const py = (i - px) / source.width;
    if (bestIdx === -1) {
      setPx(out, px, py, 240, 240, 240);
    } else {
      const c = palette[bestIdx]!.rgb;
      setPx(out, px, py, c[0], c[1], c[2]);
    }
  }
  return out;
}

function distance(a: [number, number, number] | readonly [number, number, number], b: [number, number, number] | readonly [number, number, number], space: 'rgb' | 'lab'): number {
  if (space === 'rgb') {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  }
  const la = rgbToLab(a);
  const lb = rgbToLab(b);
  return (la[0] - lb[0]) ** 2 + (la[1] - lb[1]) ** 2 + (la[2] - lb[2]) ** 2;
}

function rgbToLab(rgb: readonly [number, number, number]): [number, number, number] {
  // sRGB → linear → XYZ (D65) → Lab.
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(rgb[0]);
  const g = lin(rgb[1]);
  const b = lin(rgb[2]);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// -----------------------------------------------------------------------------
// PNG encoding (deterministic)
// -----------------------------------------------------------------------------

function writePng(filepath: string, img: RGBA): void {
  const png = new PNG({
    width: img.width,
    height: img.height,
    colorType: 6, // RGBA
    inputColorType: 6,
    bitDepth: 8,
    deflateLevel: 9,
    deflateStrategy: 0,
    filterType: 0,
  });
  // pngjs stores its buffer as `data: Buffer` of length width*height*4
  Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength).copy(png.data);
  const buf = PNG.sync.write(png, {
    deflateLevel: 9,
    deflateStrategy: 0,
    filterType: 0,
  } as Parameters<typeof PNG.sync.write>[1]);
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, buf);
}

// -----------------------------------------------------------------------------
// Matrix
// -----------------------------------------------------------------------------

const DITHER_MODES = [
  ['threshold', false as const],
  ['floyd-steinberg', 'floyd-steinberg' as const],
  ['atkinson', 'atkinson' as const],
  ['stucki', 'stucki' as const],
  ['jarvis-judice-ninke', 'jarvis-judice-ninke' as const],
  ['bayer4', 'bayer4' as const],
  ['bayer8', 'bayer8' as const],
] satisfies ReadonlyArray<readonly [string, false | 'floyd-steinberg' | 'atkinson' | 'stucki' | 'jarvis-judice-ninke' | 'bayer4' | 'bayer8']>;

function buildDithering(): void {
  const fixtures = {
    logo: makeLogo(),
    'line-art': makeLineArt(),
    photo: makePhoto(),
  };
  for (const [name, src] of Object.entries(fixtures)) {
    const dir = resolve(OUT, 'dithering', name);
    writePng(resolve(dir, 'source.png'), src);
    for (const [label, mode] of DITHER_MODES) {
      const bmp = renderImage(src, { dither: mode });
      writePng(resolve(dir, `${label}.png`), bitmapToRgba(bmp));
    }
  }
}

function buildTone(): void {
  const photo = makePhoto();
  const lowContrast = makeLowContrastScan();
  const multiColour = makeMultiColourDesign();

  // autoLevels before/after on low-contrast.
  writePng(resolve(OUT, 'tone/auto-levels/source.png'), lowContrast);
  writePng(
    resolve(OUT, 'tone/auto-levels/before.png'),
    bitmapToRgba(renderImage(lowContrast, { dither: 'floyd-steinberg' })),
  );
  writePng(
    resolve(OUT, 'tone/auto-levels/after.png'),
    bitmapToRgba(renderImage(lowContrast, { dither: 'floyd-steinberg', autoLevels: true })),
  );

  // gamma sweep on photo.
  writePng(resolve(OUT, 'tone/gamma/source.png'), photo);
  for (const g of [0.6, 0.8, 1.0, 1.2, 1.5]) {
    const label = String(g).replace('.', '_');
    writePng(
      resolve(OUT, `tone/gamma/${label}.png`),
      bitmapToRgba(renderImage(photo, { dither: 'floyd-steinberg', gamma: g })),
    );
  }

  // luminance weights on multi-colour design.
  writePng(resolve(OUT, 'tone/weights/source.png'), multiColour);
  const presets = [
    ['bt709', 'bt709' as const],
    ['bt601', 'bt601' as const],
    ['red-only', [1, 0, 0] as readonly [number, number, number]],
    ['green-only', [0, 1, 0] as readonly [number, number, number]],
  ] as const;
  for (const [label, weights] of presets) {
    writePng(
      resolve(OUT, `tone/weights/${label}.png`),
      bitmapToRgba(
        renderImage(multiColour, {
          dither: 'floyd-steinberg',
          luminanceWeights: weights,
        }),
      ),
    );
  }
}

function buildMultiPlane(): void {
  const src = makeMultiColourDesign();
  const redBlack: readonly PaletteEntry[] = [
    { name: 'black', rgb: [0, 0, 0] },
    { name: 'red', rgb: [204, 0, 0] },
  ];
  const opts: MultiPlaneRenderOptions = {
    palette: redBlack,
    defaults: { dither: 'floyd-steinberg' },
    planes: { red: { gamma: 1.15 } },
  };
  const planes = renderMultiPlaneImage(src, opts);

  writePng(resolve(OUT, 'multi-plane/source.png'), src);
  writePng(resolve(OUT, 'multi-plane/classification.png'), classificationMap(src, redBlack, 'rgb'));
  writePng(resolve(OUT, 'multi-plane/plane-black.png'), bitmapToRgba(planes.black!, [0, 0, 0]));
  writePng(resolve(OUT, 'multi-plane/plane-red.png'), bitmapToRgba(planes.red!, [204, 0, 0]));
  writePng(
    resolve(OUT, 'multi-plane/composite.png'),
    compositeMultiPlane(src.width, src.height, planes, redBlack),
  );

  // Two contrasting colorspace demos:
  //
  //  (1) close-reds: crimson vs scarlet vs blue. Crimson and scarlet are
  //      perceptually close — the boundary between them moves between RGB
  //      Euclidean and CIELAB ΔE76. This is where colorSpace: 'lab' earns
  //      its keep.
  //
  //  (2) separated: red vs green vs blue. RGB and Lab partition the source
  //      identically — both methods give the same planes. Demonstrates that
  //      Lab is unnecessary (and slightly slower) for typical separated
  //      palettes; you reach for it only when (1)-style palettes appear.
  const closeReds: readonly PaletteEntry[] = [
    { name: 'crimson', rgb: [200, 30, 40] },
    { name: 'scarlet', rgb: [220, 60, 20] },
    { name: 'blue', rgb: [40, 60, 180] },
  ];
  const closeRedsSrc = blankRgba(160, 160);
  filledCircle(closeRedsSrc, 50, 75, 30, 200, 30, 40);
  filledCircle(closeRedsSrc, 110, 75, 30, 220, 60, 20);
  filledCircle(closeRedsSrc, 80, 125, 26, 40, 60, 180);

  const separated: readonly PaletteEntry[] = [
    { name: 'red', rgb: [220, 30, 30] },
    { name: 'green', rgb: [30, 160, 60] },
    { name: 'blue', rgb: [40, 60, 200] },
  ];
  const separatedSrc = blankRgba(160, 160);
  filledCircle(separatedSrc, 50, 75, 30, 220, 30, 30);
  filledCircle(separatedSrc, 110, 75, 30, 30, 160, 60);
  filledCircle(separatedSrc, 80, 125, 26, 40, 60, 200);

  const cases = [
    { dir: 'close-reds', src: closeRedsSrc, palette: closeReds },
    { dir: 'separated', src: separatedSrc, palette: separated },
  ] as const;

  for (const c of cases) {
    for (const space of ['rgb', 'lab'] as const) {
      const dir = resolve(OUT, `multi-plane/colorspace/${c.dir}/${space}`);
      const tplanes = renderMultiPlaneImage(c.src, {
        palette: c.palette,
        colorSpace: space,
        defaults: { dither: 'floyd-steinberg' },
      });
      writePng(resolve(dir, 'source.png'), c.src);
      for (const entry of c.palette) {
        writePng(
          resolve(dir, `plane-${entry.name}.png`),
          bitmapToRgba(tplanes[entry.name]!, [entry.rgb[0], entry.rgb[1], entry.rgb[2]]),
        );
      }
      writePng(
        resolve(dir, 'composite.png'),
        compositeMultiPlane(c.src.width, c.src.height, tplanes, c.palette),
      );
    }
  }
}

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

function main(): void {
  // Warm-up to ensure rgbaToLuminance is referenced (used by the script's
  // sanity check that the lib re-export shape is what we expect).
  void rgbaToLuminance;

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  buildDithering();
  buildTone();
  buildMultiPlane();

  console.log(`Wrote docs images to ${OUT}`);
}

main();
