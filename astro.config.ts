import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://calcwise.by',
  trailingSlash: 'always',
  build: {
    format: 'directory',
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
