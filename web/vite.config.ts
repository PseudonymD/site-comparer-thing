import { defineConfig } from 'vite';

// Hosted on Vercel at the domain root. Set VITE_BASE to serve from a sub-path (e.g. /site-comparer-thing/).
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
  server: {
    host: '127.0.0.1',
    allowedHosts: [
      'debian-hackathon.tail2905d.ts.net',
      '100.102.30.87'
    ]
  }
} as never);
