<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue';
import { useData, withBase } from 'vitepress';
import { renderImage, type DitherMethod, type ImageRenderOptions } from '@bitmap';

const { isDark } = useData();

type DitherChoice = 'false' | DitherMethod;
type WeightsChoice = 'bt709' | 'bt601' | 'red' | 'green' | 'blue';

const PRESETS = [
  { label: 'Logo', src: '/images/dithering/logo/source.png' },
  { label: 'Line art', src: '/images/dithering/line-art/source.png' },
  { label: 'Photo', src: '/images/dithering/photo/source.png' },
];

const dither = ref<DitherChoice>('floyd-steinberg');
const threshold = ref(128);
const invert = ref(false);
const rotate = ref<0 | 90 | 180 | 270>(0);
const autoLevels = ref(false);
const gamma = ref(1.0);
const weights = ref<WeightsChoice>('bt709');

const sourceImage = ref<{ width: number; height: number; data: Uint8Array } | null>(null);
const sourceLabel = ref<string>('Logo');
const errorMsg = ref<string>('');
const outputCanvas = ref<HTMLCanvasElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const options = computed<ImageRenderOptions>(() => {
  const opts: ImageRenderOptions = {
    invert: invert.value,
    rotate: rotate.value,
    autoLevels: autoLevels.value,
    gamma: gamma.value,
    threshold: threshold.value,
    luminanceWeights:
      weights.value === 'bt709'
        ? 'bt709'
        : weights.value === 'bt601'
          ? 'bt601'
          : weights.value === 'red'
            ? [1, 0, 0]
            : weights.value === 'green'
              ? [0, 1, 0]
              : [0, 0, 1],
  };
  if (dither.value === 'false') {
    opts.dither = false;
  } else {
    opts.dither = dither.value;
  }
  return opts;
});

const codeSnippet = computed(() => {
  const o = options.value;
  const lines: string[] = ['renderImage(rgba, {'];
  if (o.dither !== false) lines.push(`  dither: '${String(o.dither)}',`);
  if (o.threshold !== 128 && o.dither === false) lines.push(`  threshold: ${o.threshold},`);
  if (o.invert) lines.push(`  invert: true,`);
  if (o.rotate !== 0) lines.push(`  rotate: ${o.rotate},`);
  if (o.autoLevels) lines.push(`  autoLevels: true,`);
  if (o.gamma !== 1) lines.push(`  gamma: ${o.gamma},`);
  if (typeof o.luminanceWeights !== 'string') {
    const w = o.luminanceWeights as readonly [number, number, number];
    lines.push(`  luminanceWeights: [${w[0]}, ${w[1]}, ${w[2]}],`);
  } else if (o.luminanceWeights !== 'bt709') {
    lines.push(`  luminanceWeights: '${o.luminanceWeights}',`);
  }
  lines.push('});');
  return lines.join('\n');
});

const copied = ref(false);
async function copyCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(codeSnippet.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* clipboard not available; ignore */
  }
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

function paintBitmapToCanvas(bmp: { widthPx: number; heightPx: number; data: Uint8Array }): void {
  const canvas = outputCanvas.value;
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
      const v = on ? 0 : 255;
      const idx = (y * bmp.widthPx + x) * 4;
      out.data[idx] = v;
      out.data[idx + 1] = v;
      out.data[idx + 2] = v;
      out.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

watchEffect(() => {
  const src = sourceImage.value;
  if (!src) return;
  try {
    const bmp = renderImage(src, options.value);
    paintBitmapToCanvas(bmp);
    errorMsg.value = '';
  } catch (e) {
    errorMsg.value = `Render error: ${e instanceof Error ? e.message : String(e)}`;
  }
});

onMounted(() => {
  void loadImageFromUrl(withBase(PRESETS[0]!.src), PRESETS[0]!.label);
});
</script>

<template>
  <div class="playground" :class="{ dark: isDark }">
    <div class="controls">
      <div class="control-group">
        <label>Source</label>
        <div class="presets">
          <button
            v-for="p in PRESETS"
            :key="p.label"
            type="button"
            class="preset"
            :class="{ active: sourceLabel === p.label }"
            @click="loadImageFromUrl(withBase(p.src), p.label)"
          >
            {{ p.label }}
          </button>
        </div>
        <div
          class="dropzone"
          @dragover.prevent
          @drop="onDrop"
          @click="fileInput?.click()"
        >
          drop an image, or click to choose
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            hidden
            @change="onFileChange"
          />
        </div>
      </div>

      <div class="control-group">
        <label for="dither-select">dither</label>
        <select id="dither-select" v-model="dither">
          <option value="false">false (hard threshold)</option>
          <option value="floyd-steinberg">floyd-steinberg</option>
          <option value="atkinson">atkinson</option>
          <option value="stucki">stucki</option>
          <option value="jarvis-judice-ninke">jarvis-judice-ninke</option>
          <option value="bayer4">bayer4</option>
          <option value="bayer8">bayer8</option>
        </select>
      </div>

      <div class="control-group">
        <label :for="'threshold-' + (dither === 'false' ? '' : 'disabled')">
          threshold <span class="value">{{ threshold }}</span>
        </label>
        <input
          id="threshold-range"
          v-model.number="threshold"
          type="range"
          min="0"
          max="255"
          step="1"
          :disabled="dither !== 'false'"
        />
      </div>

      <div class="control-group">
        <label for="gamma-range">
          gamma <span class="value">{{ gamma.toFixed(2) }}</span>
        </label>
        <input id="gamma-range" v-model.number="gamma" type="range" min="0.2" max="3.0" step="0.05" />
      </div>

      <div class="control-group">
        <label for="weights-select">luminance weights</label>
        <select id="weights-select" v-model="weights">
          <option value="bt709">bt709 (HDTV)</option>
          <option value="bt601">bt601 (NTSC)</option>
          <option value="red">[1, 0, 0] — red only</option>
          <option value="green">[0, 1, 0] — green only</option>
          <option value="blue">[0, 0, 1] — blue only</option>
        </select>
      </div>

      <div class="control-group">
        <label for="rotate-select">rotate</label>
        <select id="rotate-select" v-model.number="rotate">
          <option :value="0">0°</option>
          <option :value="90">90°</option>
          <option :value="180">180°</option>
          <option :value="270">270°</option>
        </select>
      </div>

      <div class="control-row">
        <label class="checkbox">
          <input v-model="autoLevels" type="checkbox" /> autoLevels
        </label>
        <label class="checkbox">
          <input v-model="invert" type="checkbox" /> invert
        </label>
      </div>
    </div>

    <div class="output">
      <div class="canvas-wrap">
        <canvas ref="outputCanvas" />
      </div>
      <div v-if="errorMsg" class="error">{{ errorMsg }}</div>
      <details class="snippet">
        <summary>
          Code snippet
          <button type="button" class="copy" @click.stop="copyCode">
            {{ copied ? 'copied!' : 'copy' }}
          </button>
        </summary>
        <pre><code>{{ codeSnippet }}</code></pre>
      </details>
    </div>
  </div>
</template>

<style scoped>
.playground {
  display: grid;
  grid-template-columns: minmax(220px, 280px) 1fr;
  gap: 24px;
  padding: 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  margin: 24px 0;
}

@media (max-width: 768px) {
  .playground {
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

.control-group label {
  color: var(--vp-c-text-2);
  font-size: 0.85rem;
  font-family: var(--vp-font-family-mono);
}

.value {
  color: var(--vp-c-text-3);
  margin-left: 6px;
}

.control-group select,
.control-group input[type='range'] {
  width: 100%;
  padding: 4px 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
}

.control-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.85rem;
  cursor: pointer;
}

.presets {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.preset {
  padding: 3px 10px;
  font-size: 0.8rem;
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

.output {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.canvas-wrap {
  background: #fff;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  overflow: auto;
}

.canvas-wrap canvas {
  max-width: 100%;
  height: auto;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

.error {
  color: var(--vp-c-danger-1);
  font-size: 0.85rem;
  font-family: var(--vp-font-family-mono);
}

.snippet {
  font-size: 0.85rem;
}

.snippet summary {
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  user-select: none;
}

.snippet pre {
  margin-top: 8px;
  padding: 12px;
  background: var(--vp-c-bg);
  border-radius: 4px;
  overflow-x: auto;
  font-size: 0.8rem;
}

.copy {
  padding: 2px 10px;
  font-size: 0.75rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  cursor: pointer;
}

.copy:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
</style>
