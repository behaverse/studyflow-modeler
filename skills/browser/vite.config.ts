import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { behaverseDevPlugins } from '../behaverse/browser/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

const pkg = JSON.parse(fs.readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as { version: string }  // one version for the repo

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Deployed the app lives under <site>/run/ (the root build merges it into
  // dist/run), so built asset URLs stay relative; in dev the same /run/ prefix
  // lets the modeler's server proxy this one under a single origin.
  base: command === 'serve' ? '/run/' : '',
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(pkg.version),
  },
  plugins: [
    tailwindcss(),
    react(),
    ...behaverseDevPlugins(),
  ],
  resolve: {
    alias: [
      { find: '@core', replacement: resolve(__dirname, '../../packages/core/src') },
      { find: '@runner', replacement: resolve(__dirname, 'src') },
      { find: '@skills', replacement: resolve(__dirname, '../../skills') },
      { find: '#assets', replacement: resolve(__dirname, '../../assets') },
    ],
  },
  server: {
    port: 5174,
    fs: { allow: [resolve(__dirname, '../..')] },
  },
  build: {
    outDir: '../../dist/run',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        runner: resolve(__dirname, 'index.html'),
      },
    },
  },
  assetsInclude: [
    '**/*.png', '**/*.bpmn', '**/*.studyflow', '**/*.jpeg', '**/*.gif',
    '**/*.svg', '**/*.ico', '**/*.webp', '**/*.yaml',
  ],
}))
