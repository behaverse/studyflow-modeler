import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import tailwindcss from 'tailwindcss'
import react from '@vitejs/plugin-react'
import mdx from '@mdx-js/rollup'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'


const __dirname = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  root: './src',
  publicDir: false, // disable public directory
  base: '',  // relative base
  plugins: [
    {
      enforce: 'pre', ...mdx(
        {
          remarkPlugins: [remarkFrontmatter, remarkGfm],
        }
    ) },
    react()],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '#root': resolve(__dirname)
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000, // increase chunk size warning limit
    rollupOptions: {
      input: {
        main: resolve(__dirname, '/index.html'),
        about: resolve(__dirname, '/about/index.html'),
        modeler: resolve(__dirname, '/app/index.html'),
      }
    },

  },
  assetsInclude: ['**/*.png', '**/*.bpmn', '**/*.jpeg', '**/*.gif', '**/*.svg', '**/*.ico', '**/*.webp'],
})
