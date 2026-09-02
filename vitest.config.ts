import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const domainEntry = fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@cats-tower/domain': domainEntry,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/v2/**/*.test.ts'],
    coverage: {
      enabled: false,
    },
  },
});
