import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// This synthetic source is built only by the disposable media test, never the product build.
export default defineConfig({
  root: resolve(import.meta.dirname, '../../tests/media-proof/publisher'),
  build: {
    outDir:
      process.env.MEDIA_PROOF_PUBLISHER_BUILD ??
      resolve(import.meta.dirname, '../../node_modules/.cache/screen-share-media-publisher'),
    emptyOutDir: true,
  },
});
