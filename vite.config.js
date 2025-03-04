import { resolve } from 'path'
import { defineConfig } from 'vite'
import tailwindcss from 'tailwindcss'
import react from '@vitejs/plugin-react-swc'
import mdx from '@mdx-js/rollup'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'

// https://vite.dev/config/
export default defineConfig({
  base: '',  // relative base
  plugins: [
    {
      enforce: 'pre', ...mdx(
        {
          remarkPlugins: [remarkFrontmatter, remarkGfm],
        }
    ) },
    react({include: /\.(jsx|js|mdx|md)$/})],
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
