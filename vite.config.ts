import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves this project from /ainogo/, while local development
  // and preview use the site root.
  base: process.env.GITHUB_ACTIONS ? '/ainogo/' : '/',
});
