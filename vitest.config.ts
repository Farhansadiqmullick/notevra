import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Node environment + fake-indexeddb: the sync engine is pure logic over Dexie, so it needs a real
 * IndexedDB but no DOM. `setupFiles` installs the fake before any module imports Dexie.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
  },
});
