import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  root: './src',
  publicDir: false, // disable public directory
  base: '',  // relative base
  plugins: [
    tailwindcss(),
    react()],
  css: {
    postcss: {
      plugins: [],
    }
  },
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, 'src') },
      { find: /^ids-raw$/, replacement: resolve(__dirname, 'node_modules/ids/dist/index.js') },
      { find: /^ids$/, replacement: resolve(__dirname, 'src/shims/ids-default.ts') },
      { find: '#root', replacement: resolve(__dirname) }
    ],
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000, // increase chunk size warning limit
    rollupOptions: {
      input: {
        main: resolve(__dirname, './src/index.html'),
        modeler: resolve(__dirname, './src/app.html'),
      }
    },

  },
  assetsInclude: [
    '**/*.png', '**/*.bpmn', '**/*.jpeg', '**/*.gif',
    '**/*.svg', '**/*.ico', '**/*.webp', '**/*.yaml'],
})
