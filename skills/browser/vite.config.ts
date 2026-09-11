import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { behaverseDevPlugins } from '../behaverse/browser/vite'
import { ROOT, aliases, define } from '../../vite.shared'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Deployed the app lives under <site>/run/ (the root build merges it into dist/run), so built asset URLs stay
  // relative; in dev the same /run/ prefix is where the modeler's dev server hosts this one (its `runner` plugin).
  base: command === 'serve' ? '/run/' : '',
  define,
  plugins: [
    tailwindcss(),
    react(),
    ...behaverseDevPlugins(),
  ],
  resolve: { alias: aliases },
  server: {
    fs: { allow: [ROOT] },
  },
  build: {
    outDir: '../../dist/run',
    emptyOutDir: true,  // its own corner of dist/, which the modeler's build leaves alone: the order of the two does not matter
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        runner: resolve(import.meta.dirname, 'index.html'),
      },
    },
  },
}))
