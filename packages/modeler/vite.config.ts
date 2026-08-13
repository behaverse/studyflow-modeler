import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

const pkg = JSON.parse(fs.readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string }

// In dev the runner is a second Vite server, but the diagram hand-off between the
// two apps rides on same-origin localStorage — so the runner's paths are proxied
// through this origin, exactly as the merged dist/ serves them in production.
const RUNNER_PORT = Number(process.env.RUNNER_PORT ?? 5174)
const RUNNER_PATHS = ['/run', '/assessment-unity', '/api/llm']

// https://vite.dev/config/
export default defineConfig({
  base: '',  // relative
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(pkg.version),
  },
  plugins: [
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: [
      // Workspace packages are consumed as TypeScript source (see root vite.config note).
      { find: '@core', replacement: resolve(__dirname, '../core/src') },
      { find: '@modeler', replacement: resolve(__dirname, 'src') },
      { find: '#assets', replacement: resolve(__dirname, '../../assets') },
    ],
  },
  server: {
    port: 5173,
    fs: { allow: [resolve(__dirname, '../..')] },
    proxy: Object.fromEntries(
      // 'localhost', not 127.0.0.1: the runner may bind only the IPv6 loopback.
      RUNNER_PATHS.map((path) => [path, { target: `http://localhost:${RUNNER_PORT}` }]),
    ),
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        modeler: resolve(__dirname, 'app.html'),
      },
    },
  },
  assetsInclude: [
    '**/*.png', '**/*.bpmn', '**/*.studyflow', '**/*.jpeg', '**/*.gif',
    '**/*.svg', '**/*.ico', '**/*.webp', '**/*.yaml',
  ],
})
