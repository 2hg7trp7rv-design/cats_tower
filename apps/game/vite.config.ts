import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const domainEntry = fileURLToPath(
  new URL('../../packages/domain/src/index.ts', import.meta.url),
);
const outputDirectory = fileURLToPath(new URL('../../dist/v2', import.meta.url));

export default defineConfig({
  root: appRoot,
  plugins: [react()],
  resolve: {
    alias: {
      '@cats-tower/domain': domainEntry,
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
