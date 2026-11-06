import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Separate output: building the experiment never replaces the main site's dist.
export default defineConfig({
  build: { outDir: 'dist-lab', rollupOptions: { input: resolve(import.meta.dirname, 'lab.html') } },
});
