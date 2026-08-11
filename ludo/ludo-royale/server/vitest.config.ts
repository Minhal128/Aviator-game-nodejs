import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Point at the workspace SOURCE (same trick as client/vite.config.ts) so
    // tests run without a prior `npm run build:shared`.
    alias: {
      '@ludo/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Each test file boots its own Colyseus server on the same port —
    // serialize files to avoid EADDRINUSE.
    fileParallelism: false,
    // Colyseus bundles PM2's pmx/axm agent, which calls process.send() when it
    // sees an IPC channel and corrupts vitest's forked-pool protocol. Worker
    // threads have no process.send, so the agent stays quiet.
    pool: 'threads',
    testTimeout: 90000,
    hookTimeout: 20000,
  },
});
