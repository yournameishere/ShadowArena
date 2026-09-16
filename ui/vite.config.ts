import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react(), wasm()],
  resolve: {
    alias: {
      events: 'events/events.js',
      assert: 'assert/build/assert.js',
      'isomorphic-ws': resolve(uiRoot, 'src/isomorphic-ws.ts'),
    },
  },
  define: {
    process: { env: {} },
  },
  server: { port: 5173 },
  build: { target: 'es2022' },
});
