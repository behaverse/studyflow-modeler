import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  root: './app',
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
    alias: {
      '@': resolve(__dirname, 'app'),
      '#root': resolve(__dirname)
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000, // increase chunk size warning limit
    rollupOptions: {
      input: {
        main: resolve(__dirname, './app/index.html'),
        modeler: resolve(__dirname, './app/app.html'),
      }
    },

  },
  assetsInclude: ['**/*.png', '**/*.bpmn', '**/*.jpeg', '**/*.gif', '**/*.svg', '**/*.ico', '**/*.webp'],
})
