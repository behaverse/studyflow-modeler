import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'
import { defineConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

const pkg = JSON.parse(fs.readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string }

// A single self-contained Node executable: core is compiled in from source and
// the schema YAMLs are inlined at build time (core's `import.meta.glob(?raw)`),
// so the binary resolves nothing from the repo at runtime.
export default defineConfig({
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(pkg.version),
  },
  resolve: {
    alias: [
      { find: '@core', replacement: resolve(__dirname, '../core/src') },
      { find: '@cli', replacement: resolve(__dirname, 'src') },
      { find: '#assets', replacement: resolve(__dirname, '../../assets') },
    ],
  },
  ssr: {
    noExternal: true,
    // `render` drives a browser; playwright stays an install-time optional.
    external: ['@playwright/test'],
  },
  build: {
    ssr: true,
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { studyflow: resolve(__dirname, 'src/index.ts') },
      output: {
        entryFileNames: '[name].mjs',
        banner: '#!/usr/bin/env node',
      },
    },
  },
})
