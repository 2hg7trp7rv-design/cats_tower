import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const domainEntry = fileURLToPath(
  new URL('../../packages/domain/src/index.ts', import.meta.url),
);
const outputDirectory = fileURLToPath(new URL('../../dist/v2', import.meta.url));
const browserCryptoBridge = fileURLToPath(
  new URL('../../packages/domain/src/browser/node-crypto.ts', import.meta.url),
);
const browserFsPromisesBridge = fileURLToPath(
  new URL('../../packages/domain/src/browser/node-fs-promises.ts', import.meta.url),
);

export default defineConfig({
  root: appRoot,
  plugins: [react()],
  resolve: {
    alias: {
      '@cats-tower/domain': domainEntry,
      'node:crypto': browserCryptoBridge,
      'node:fs/promises': browserFsPromisesBridge,
    },
  },
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
