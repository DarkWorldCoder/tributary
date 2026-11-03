import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Relative base and stable file names so the same build loads from file:// (Electron)
// and from a VS Code webview, which rewrites asset URLs.
export default defineConfig({
  base: './',
  worker: { format: 'es', rolldownOptions: { output: { codeSplitting: false } } },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  build: {
    outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 2000,
    rolldownOptions: { output: { entryFileNames: 'assets/app.js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name][extname]' } },
  },
});
