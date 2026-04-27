import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type DefaultTheme } from 'vitepress';

const apiSidebar: DefaultTheme.SidebarItem[] = (() => {
  try {
    const raw = readFileSync(
      fileURLToPath(new URL('../api/typedoc-sidebar.json', import.meta.url)),
      'utf-8',
    );
    return JSON.parse(raw) as DefaultTheme.SidebarItem[];
  } catch {
    return [{ text: 'API reference', link: '/api/' }];
  }
})();

export default defineConfig({
  base: '/bitmap/',
  title: '@mbtech-nl/bitmap',
  description:
    '1bpp bitmap rendering core for thermal label printers — dithering, multi-plane colour, transforms.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['meta', { name: 'theme-color', content: '#1a1a1a' }],
    ['meta', { property: 'og:title', content: '@mbtech-nl/bitmap' }],
    [
      'meta',
      {
        property: 'og:description',
        content: '1bpp bitmap rendering core for thermal label printers.',
      },
    ],
  ],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Recipes', link: '/recipes/' },
      { text: 'API', link: '/api/' },
      {
        text: 'v1',
        items: [
          {
            text: 'Changelog',
            link: 'https://github.com/mbtech-nl/bitmap/releases',
          },
          {
            text: 'npm',
            link: 'https://www.npmjs.com/package/@mbtech-nl/bitmap',
          },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Dithering', link: '/guide/dithering' },
            { text: 'Tone & luminance', link: '/guide/tone-and-luminance' },
            { text: 'Multi-plane output', link: '/guide/multi-plane' },
            { text: 'Pipeline order', link: '/guide/pipeline' },
          ],
        },
      ],
      '/recipes/': [
        {
          text: 'Recipes',
          items: [
            { text: 'Overview', link: '/recipes/' },
            { text: 'Scale a logo to printer width', link: '/recipes/scale-logo-to-printer-width' },
            { text: 'Stack header above body', link: '/recipes/stack-header-and-body' },
            { text: 'Render text and image', link: '/recipes/render-text-and-image' },
            { text: 'Find the right gamma', link: '/recipes/find-the-right-gamma' },
          ],
        },
      ],
      '/api/': [{ text: 'API reference', link: '/api/' }, ...apiSidebar],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/mbtech-nl/bitmap' }],

    search: { provider: 'local' },

    editLink: {
      pattern: 'https://github.com/mbtech-nl/bitmap/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: '© MBTech',
    },
  },

  vite: {
    resolve: {
      alias: {
        '@bitmap': fileURLToPath(new URL('../../src', import.meta.url)),
      },
    },
  },
});
