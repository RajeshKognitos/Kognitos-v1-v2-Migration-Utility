import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Load .env.local (e.g. OPENAI_API_KEY) before any test runs.
    setupFiles: ['tests/setup.env.ts'],
    // The HAR fixture is ~15MB; parsing + extraction needs headroom.
    testTimeout: 20000,
  },
});
