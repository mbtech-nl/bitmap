<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { withBase } from 'vitepress';

interface Tile {
  label: string;
  src: string;
  caption?: string;
}

const props = defineProps<{ tiles: Tile[] }>();

const ZOOM_LEVELS = [1, 2, 4, 8] as const;
type Zoom = (typeof ZOOM_LEVELS)[number];

const lightboxIdx = ref<number | null>(null);
const zoom = ref<Zoom>(1);

const current = computed(() =>
  lightboxIdx.value !== null ? props.tiles[lightboxIdx.value] : null,
);

function open(i: number): void {
  lightboxIdx.value = i;
  zoom.value = 1;
}

function close(): void {
  lightboxIdx.value = null;
}

function next(): void {
  if (lightboxIdx.value === null) return;
  if (lightboxIdx.value < props.tiles.length - 1) {
    lightboxIdx.value += 1;
    zoom.value = 1;
  }
}

function prev(): void {
  if (lightboxIdx.value === null) return;
  if (lightboxIdx.value > 0) {
    lightboxIdx.value -= 1;
    zoom.value = 1;
  }
}

function onKey(e: KeyboardEvent): void {
  if (lightboxIdx.value === null) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowLeft') prev();
  else if (e.key === 'ArrowRight') next();
  else if (e.key === '1') zoom.value = 1;
  else if (e.key === '2') zoom.value = 2;
  else if (e.key === '4') zoom.value = 4;
  else if (e.key === '8') zoom.value = 8;
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="dither-gallery">
    <figure
      v-for="(t, i) in tiles"
      :key="t.label"
      class="dither-tile"
      @click="open(i)"
    >
      <img :src="withBase(t.src)" :alt="t.label" loading="lazy" />
      <figcaption>
        <strong>{{ t.label }}</strong>
        <span v-if="t.caption">{{ t.caption }}</span>
      </figcaption>
    </figure>

    <Teleport v-if="current" to="body">
      <div class="lightbox" role="dialog" aria-modal="true" @click.self="close">
        <button class="lb-close" type="button" aria-label="Close" @click="close">×</button>

        <div class="lb-caption">
          <strong>{{ current.label }}</strong>
          <span class="lb-counter">
            {{ (lightboxIdx ?? 0) + 1 }} / {{ tiles.length }}
          </span>
        </div>

        <button
          class="lb-arrow lb-prev"
          type="button"
          aria-label="Previous"
          :disabled="lightboxIdx === 0"
          @click="prev"
        >
          ‹
        </button>

        <div class="lb-stage">
          <img
            :src="withBase(current.src)"
            :alt="current.label"
            :style="{ transform: `scale(${zoom})` }"
            class="lb-image"
          />
        </div>

        <button
          class="lb-arrow lb-next"
          type="button"
          aria-label="Next"
          :disabled="lightboxIdx === tiles.length - 1"
          @click="next"
        >
          ›
        </button>

        <div class="lb-controls">
          <span class="lb-controls-label">zoom</span>
          <button
            v-for="z in ZOOM_LEVELS"
            :key="z"
            type="button"
            :class="{ active: zoom === z }"
            @click="zoom = z"
          >
            {{ z }}×
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.dither-gallery {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 24px 0;
  align-items: flex-start;
}

.dither-tile {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: zoom-in;
}

.dither-tile img {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: #fff;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  transition: border-color 100ms ease-out;
}

.dither-tile:hover img {
  border-color: var(--vp-c-brand-1);
}

.dither-tile figcaption {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  display: flex;
  flex-direction: column;
  text-align: center;
}

.dither-tile figcaption strong {
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-weight: 500;
  font-size: 0.85rem;
}

.lightbox {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.88);
  display: grid;
  grid-template-columns: 56px 1fr 56px;
  grid-template-rows: 1fr auto;
  align-items: center;
  justify-items: center;
  padding: 24px;
}

.lb-close {
  position: fixed;
  top: 16px;
  right: 16px;
  background: transparent;
  color: #fff;
  border: 1px solid #888;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1.4rem;
  line-height: 1;
  display: grid;
  place-items: center;
  font-family: inherit;
}

.lb-close:hover {
  border-color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

.lb-caption {
  position: fixed;
  top: 16px;
  left: 16px;
  color: #fff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lb-counter {
  color: #aaa;
  font-size: 0.75rem;
}

.lb-stage {
  grid-column: 2;
  grid-row: 1;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  overflow: auto;
}

.lb-image {
  background: #fff;
  border: 1px solid #444;
  display: block;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  transform-origin: center;
  transition: transform 120ms ease-out;
}

.lb-arrow {
  background: transparent;
  color: #fff;
  border: 1px solid #888;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1.6rem;
  line-height: 1;
  display: grid;
  place-items: center;
  font-family: inherit;
}

.lb-arrow:hover:not(:disabled) {
  border-color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

.lb-arrow:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.lb-prev {
  grid-column: 1;
  grid-row: 1;
}

.lb-next {
  grid-column: 3;
  grid-row: 1;
}

.lb-controls {
  grid-column: 1 / -1;
  grid-row: 2;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.06);
  padding: 6px 10px;
  border-radius: 8px;
  margin-top: 12px;
}

.lb-controls-label {
  color: #aaa;
  font-size: 0.78rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  margin-right: 6px;
}

.lb-controls button {
  background: transparent;
  color: #ddd;
  border: 1px solid transparent;
  padding: 5px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
}

.lb-controls button:hover {
  border-color: #555;
}

.lb-controls button.active {
  background: #fff;
  color: #000;
  border-color: #fff;
}

@media (max-width: 600px) {
  .lightbox {
    grid-template-columns: 40px 1fr 40px;
    padding: 12px;
  }
  .lb-arrow {
    width: 36px;
    height: 36px;
  }
}
</style>
