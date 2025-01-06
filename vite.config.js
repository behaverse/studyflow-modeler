import { resolve } from 'path'
import { defineConfig } from 'vite'
import tailwindcss from 'tailwindcss'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  base: '',  // relative base
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        modeler: resolve(__dirname, 'app/index.html'),
        about: resolve(__dirname, 'about/index.html'),
      }
    },
  },
  assetsInclude: ['**/*.png', '**/*.bpmn', '**/*.jpeg', '**/*.gif', '**/*.svg', '**/*.ico', '**/*.webp'],
})
