import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import DitherGallery from './components/DitherGallery.vue';
import Playground from './components/Playground.vue';
import MultiPlanePlayground from './components/MultiPlanePlayground.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('DitherGallery', DitherGallery);
    app.component('Playground', Playground);
    app.component('MultiPlanePlayground', MultiPlanePlayground);
  },
} satisfies Theme;
