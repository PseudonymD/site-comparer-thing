import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo-name>/. Override with VITE_BASE if needed.
const base = process.env.VITE_BASE ?? (process.env.GITHUB_ACTIONS ? '/site-comparer-thing/' : '/');

export default defineConfig({
  base,
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
} as never);
