<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue';
import { useData, withBase } from 'vitepress';
import {
  renderMultiPlaneImage,
  type DitherMethod,
  type LabelBitmap,
  type MultiPlaneRenderOptions,
  type PaletteEntry,
} from '@bitmap';

const { isDark } = useData();

interface PaletteRow {
  name: string;
  rgb: [number, number, number];
}

const PRESETS: { label: string; palette: PaletteRow[] }[] = [
  {
    label: 'Brother QL-800 (red+black)',
    palette: [
      { name: 'black', rgb: [0, 0, 0] },
      { name: 'red', rgb: [204, 0, 0] },
    ],
  },
  {
    label: 'DYMO (black+blue)',
    palette: [
      { name: 'black', rgb: [0, 0, 0] },
      { name: 'blue', rgb: [30, 70, 180] },
    ],
  },
  {
    label: '3-colour (close reds + blue)',
    palette: [
      { name: 'crimson', rgb: [200, 30, 40] },
      { name: 'scarlet', rgb: [220, 60, 20] },
      { name: 'blue', rgb: [40, 60, 180] },
    ],
  },
];

const SOURCE_PRESETS = [
  { label: 'Multi-colour design', src: '/images/multi-plane/source.png' },
  { label: '3-colour test', src: '/images/multi-plane/colorspace/rgb/source.png' },
];

const palette = ref<PaletteRow[]>(PRESETS[0]!.palette.map(p => ({ ...p, rgb: [...p.rgb] as [number, number, number] })));
const colorSpace = ref<'rgb' | 'lab'>('rgb');
const dither = ref<DitherMethod | 'false'>('floyd-steinberg');

const sourceImage = ref<{ width: number; height: number; data: Uint8Array } | null>(null);
const sourceLabel = ref<string>(SOURCE_PRESETS[0]!.label);
const errorMsg = ref<string>('');
const planes = ref<Record<string, LabelBitmap>>({});
const compositeCanvas = ref<HTMLCanvasElement | null>(null);
const planeRefs = ref<Record<string, HTMLCanvasElement | null>>({});
const fileInput = ref<HTMLInputElement | null>(null);

const validatedPalette = computed<PaletteEntry[] | null>(() => {
  const out: PaletteEntry[] = [];
  const seen = new Set<string>();
  for (const row of palette.value) {
    if (!row.name) return null;
    if (row.name === 'white') return null;
    if (seen.has(row.name)) return null;
    seen.add(row.name);
    if (row.rgb.some(v => !Number.isInteger(v) || v < 0 || v > 255)) return null;
    if (row.rgb[0] === 255 && row.rgb[1] === 255 && row.rgb[2] === 255) return null;
    out.push({ name: row.name, rgb: [row.rgb[0], row.rgb[1], row.rgb[2]] });
  }
  return out.length > 0 ? out : null;
});

function applyPreset(label: string): void {
  const preset = PRESETS.find(p => p.label === label);
  if (preset) {
    palette.value = preset.palette.map(p => ({ ...p, rgb: [...p.rgb] as [number, number, number] }));
  }
}

function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

async function loadImageFromUrl(url: string, label: string): Promise<void> {
  errorMsg.value = '';
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    sourceImage.value = {
      width: canvas.width,
      height: canvas.height,
      data: new Uint8Array(data.data.buffer.slice(0)),
    };
    sourceLabel.value = label;
  } catch (e) {
    errorMsg.value = `Could not load image: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  void loadImageFromUrl(url, file.name);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function onDrop(e: DragEvent): void {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  void loadImageFromUrl(url, file.name);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function paintPlaneToCanvas(
  canvas: HTMLCanvasElement | null | undefined,
  bmp: LabelBitmap,
  ink: [number, number, number],
): void {
  if (!canvas) return;
  canvas.width = bmp.widthPx;
  canvas.height = bmp.heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const out = ctx.createImageData(bmp.widthPx, bmp.heightPx);
  const rowBytes = Math.ceil(bmp.widthPx / 8);
  for (let y = 0; y < bmp.heightPx; y += 1) {
    for (let x = 0; x < bmp.widthPx; x += 1) {
      const byte = bmp.data[y * rowBytes + Math.floor(x / 8)] ?? 0;
      const on = (byte >> (7 - (x % 8))) & 1;
      const idx = (y * bmp.widthPx + x) * 4;
      if (on) {
        out.data[idx] = ink[0];
        out.data[idx + 1] = ink[1];
        out.data[idx + 2] = ink[2];
      } else {
        out.data[idx] = 255;
        out.data[idx + 1] = 255;
        out.data[idx + 2] = 255;
      }
      out.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

function paintComposite(
  canvas: HTMLCanvasElement | null,
  result: Record<string, LabelBitmap>,
  pal: readonly PaletteEntry[],
): void {
  if (!canvas) return;
  const first = result[pal[0]?.name ?? ''];
  if (!first) return;
  canvas.width = first.widthPx;
  canvas.height = first.heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const out = ctx.createImageData(first.widthPx, first.heightPx);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 255;
    out.data[i + 1] = 255;
    out.data[i + 2] = 255;
    out.data[i + 3] = 255;
  }
  for (const entry of pal) {
    const bmp = result[entry.name];
    if (!bmp) continue;
    const rowBytes = Math.ceil(bmp.widthPx / 8);
    for (let y = 0; y < bmp.heightPx; y += 1) {
      for (let x = 0; x < bmp.widthPx; x += 1) {
        const byte = bmp.data[y * rowBytes + Math.floor(x / 8)] ?? 0;
        const on = (byte >> (7 - (x % 8))) & 1;
        if (on) {
          const idx = (y * bmp.widthPx + x) * 4;
          out.data[idx] = entry.rgb[0];
          out.data[idx + 1] = entry.rgb[1];
          out.data[idx + 2] = entry.rgb[2];
        }
      }
    }
  }
  ctx.putImageData(out, 0, 0);
}

watchEffect(() => {
  const src = sourceImage.value;
  const pal = validatedPalette.value;
  if (!src || !pal) {
    if (!pal) errorMsg.value = 'palette has duplicates, empty/white name, or invalid rgb';
    return;
  }
  try {
    const opts: MultiPlaneRenderOptions = {
      palette: pal,
      colorSpace: colorSpace.value,
      defaults: { dither: dither.value === 'false' ? false : dither.value },
    };
    const result = renderMultiPlaneImage(src, opts);
    planes.value = result;
    paintComposite(compositeCanvas.value, result, pal);
    for (const entry of pal) {
      const bmp = result[entry.name];
      if (bmp) {
        paintPlaneToCanvas(planeRefs.value[entry.name], bmp, [
          entry.rgb[0],
          entry.rgb[1],
          entry.rgb[2],
        ]);
      }
    }
    errorMsg.value = '';
  } catch (e) {
    errorMsg.value = `Render error: ${e instanceof Error ? e.message : String(e)}`;
  }
});

function setPlaneRef(name: string, el: Element | unknown): void {
  if (el instanceof HTMLCanvasElement) {
    planeRefs.value[name] = el;
  }
}

onMounted(() => {
  void loadImageFromUrl(withBase(SOURCE_PRESETS[0]!.src), SOURCE_PRESETS[0]!.label);
});
</script>

<template>
  <div class="mp-playground" :class="{ dark: isDark }">
    <div class="controls">
      <div class="control-group">
        <label>Source</label>
        <div class="presets">
          <button
            v-for="p in SOURCE_PRESETS"
            :key="p.label"
            type="button"
            class="preset"
            :class="{ active: sourceLabel === p.label }"
            @click="loadImageFromUrl(withBase(p.src), p.label)"
          >
            {{ p.label }}
          </button>
        </div>
        <div class="dropzone" @dragover.prevent @drop="onDrop" @click="fileInput?.click()">
          drop an image, or click to choose
          <input ref="fileInput" type="file" accept="image/*" hidden @change="onFileChange" />
        </div>
      </div>

      <div class="control-group">
        <label>Palette preset</label>
        <div class="presets">
          <button
            v-for="p in PRESETS"
            :key="p.label"
            type="button"
            class="preset"
            @click="applyPreset(p.label)"
          >
            {{ p.label }}
          </button>
        </div>
      </div>

      <div class="control-group">
        <label>Palette</label>
        <div v-for="(row, i) in palette" :key="i" class="palette-row">
          <input
            v-model="row.name"
            type="text"
            class="name-input"
            placeholder="name"
            spellcheck="false"
          />
          <input
            type="color"
            :value="rgbToHex(row.rgb)"
            class="color-input"
            @input="row.rgb = hexToRgb(($event.target as HTMLInputElement).value)"
          />
          <button
            type="button"
            class="remove"
            :disabled="palette.length <= 1"
            @click="palette.splice(i, 1)"
          >
            ×
          </button>
        </div>
        <button
          type="button"
          class="add-row"
          @click="palette.push({ name: 'extra', rgb: [128, 128, 128] })"
        >
          + add entry
        </button>
      </div>

      <div class="control-group">
        <label for="cs-select">colorSpace</label>
        <select id="cs-select" v-model="colorSpace">
          <option value="rgb">rgb</option>
          <option value="lab">lab (CIELAB ΔE76)</option>
        </select>
      </div>

      <div class="control-group">
        <label for="mp-dither">dither</label>
        <select id="mp-dither" v-model="dither">
          <option value="false">false (hard threshold)</option>
          <option value="floyd-steinberg">floyd-steinberg</option>
          <option value="atkinson">atkinson</option>
          <option value="stucki">stucki</option>
          <option value="jarvis-judice-ninke">jarvis-judice-ninke</option>
          <option value="bayer4">bayer4</option>
          <option value="bayer8">bayer8</option>
        </select>
      </div>
    </div>

    <div class="output">
      <div v-if="errorMsg" class="error">{{ errorMsg }}</div>
      <div class="grid">
        <figure>
          <canvas ref="compositeCanvas" />
          <figcaption>composite</figcaption>
        </figure>
        <figure v-for="entry in validatedPalette ?? []" :key="entry.name">
          <canvas :ref="(el) => setPlaneRef(entry.name, el)" />
          <figcaption>plane: {{ entry.name }}</figcaption>
        </figure>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mp-playground {
  display: grid;
  grid-template-columns: minmax(240px, 320px) 1fr;
  gap: 24px;
  padding: 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  margin: 24px 0;
}

@media (max-width: 768px) {
  .mp-playground {
    grid-template-columns: 1fr;
  }
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 0.9rem;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.control-group > label {
  color: var(--vp-c-text-2);
  font-size: 0.85rem;
  font-family: var(--vp-font-family-mono);
}

.control-group select {
  padding: 4px 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
}

.presets {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.preset {
  padding: 3px 10px;
  font-size: 0.78rem;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  border-radius: 4px;
  cursor: pointer;
}

.preset.active {
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  border-color: var(--vp-c-brand-1);
}

.preset:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.dropzone {
  border: 1px dashed var(--vp-c-divider);
  border-radius: 4px;
  padding: 12px;
  text-align: center;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  cursor: pointer;
  margin-top: 4px;
}

.dropzone:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.palette-row {
  display: grid;
  grid-template-columns: 1fr 36px 28px;
  gap: 4px;
  align-items: center;
}

.name-input {
  padding: 3px 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.85rem;
}

.color-input {
  height: 28px;
  width: 36px;
  padding: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  cursor: pointer;
  background: transparent;
}

.remove {
  padding: 2px 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-3);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}

.remove:hover:not(:disabled) {
  color: var(--vp-c-danger-1);
  border-color: var(--vp-c-danger-1);
}

.remove:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.add-row {
  margin-top: 4px;
  padding: 4px 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  border: 1px dashed var(--vp-c-divider);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}

.add-row:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.output .grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.output figure {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.output canvas {
  width: 100%;
  height: auto;
  background: #fff;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

.output figcaption {
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  color: var(--vp-c-text-2);
  text-align: center;
}

.error {
  color: var(--vp-c-danger-1);
  font-size: 0.85rem;
  font-family: var(--vp-font-family-mono);
  margin-bottom: 8px;
}
</style>
