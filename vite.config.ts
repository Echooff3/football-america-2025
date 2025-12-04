import { defineConfig } from 'vite';

export default defineConfig({
  // Base path for GitHub Pages deployment (repo name)
  base: process.env.GITHUB_ACTIONS ? '/football-america-2025/' : '/',
  server: {
    headers: {
      // Enable cross-origin isolation for SharedArrayBuffer and better WASM threading
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
});
