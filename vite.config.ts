import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'manifest.json',
          dest: '.'
        },
        {
          src: 'src/content/overlay.css',
          dest: 'content'
        },
        {
          src: 'src/assets/model_q4.onnx',
          dest: 'assets'
        }
      ]
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        scanner: resolve(__dirname, 'src/content/scanner.ts')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'service-worker') {
            return 'background/service-worker.js';
          }
          if (chunkInfo.name === 'scanner') {
            return 'content/scanner.js';
          }
          if (chunkInfo.name === 'offscreen') {
            return 'offscreen/offscreen.js';
          }
          if (chunkInfo.name === 'popup') {
            return 'popup/popup.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || (assetInfo.names && assetInfo.names[0]) || '';
          if (name.endsWith('.wasm')) {
            return 'assets/[name].[ext]';
          }
          return 'assets/[name]-[hash].[ext]';
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
});
