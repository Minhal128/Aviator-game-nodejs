import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// The alias points at the workspace SOURCE so Vite compiles @ludo/shared
// directly — no separate `npm run build:shared` step during development.
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@ludo/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    // Same-origin /api in dev too: the overlay meta layer always calls
    // relative /api/v1 (prod nginx proxies it; here Vite does).
    proxy: {
      '/api': 'http://localhost:8110',
    },
  },
  preview: {
    port: 8106,
    strictPort: true,
    // `vite preview` is a local sanity-check server, not how the
    // production build is served (Documentation > Production Deploy
    // serves client/dist/ as static files behind nginx). Allow any Host
    // header here so the buyer's own domain is never blocked.
    allowedHosts: true,
  },
});
