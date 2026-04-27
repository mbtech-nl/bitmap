<script setup lang="ts">
import { withBase } from 'vitepress';

interface Tile {
  label: string;
  src: string;
  caption?: string;
}

defineProps<{
  tiles: Tile[];
  columns?: number;
}>();
</script>

<template>
  <div class="dither-gallery" :style="{ '--cols': columns ?? 4 }">
    <figure v-for="t in tiles" :key="t.label" class="dither-tile">
      <img :src="withBase(t.src)" :alt="t.label" loading="lazy" />
      <figcaption>
        <strong>{{ t.label }}</strong>
        <span v-if="t.caption">{{ t.caption }}</span>
      </figcaption>
    </figure>
  </div>
</template>

<style scoped>
.dither-gallery {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  gap: 16px;
  margin: 24px 0;
}

@media (max-width: 768px) {
  .dither-gallery {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 480px) {
  .dither-gallery {
    grid-template-columns: 1fr;
  }
}

.dither-tile {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dither-tile img {
  width: 100%;
  height: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: #fff;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

.dither-tile figcaption {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  display: flex;
  flex-direction: column;
}

.dither-tile figcaption strong {
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-weight: 500;
}
</style>
