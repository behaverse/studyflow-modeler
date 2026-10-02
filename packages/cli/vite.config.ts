import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import { aliases, define } from '../../vite.shared'

// One self-contained Node executable: core is compiled in from source and the schema YAMLs are inlined at build
// time (core's `import.meta.glob(?raw)`). At run time it finds the local runtime and the modeler it serves beside
// itself: skills/ and dist/ in a checkout, libexec/ in the Homebrew install.
export default defineConfig({
  define,
  resolve: { alias: aliases },
  ssr: {
    noExternal: true,
    // `convert --modeler` drives a browser; playwright stays an install-time optional.
    external: ['@playwright/test'],
  },
  build: {
    ssr: true,
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    // Under `npm run coverage` (c8 sets NODE_V8_COVERAGE) a spec's build carries its sources, so what the built CLI runs
    // counts toward them.
    sourcemap: process.env.NODE_V8_COVERAGE ? 'inline' : false,
    rollupOptions: {
      input: { studyflow: resolve(import.meta.dirname, 'src/cli.ts') },
      output: {
        entryFileNames: '[name].mjs',
        banner: '#!/usr/bin/env node',
        // One file: the bin resolves the repo's skills relative to
        // import.meta.url, which code-split chunks would point elsewhere.
        inlineDynamicImports: true,
        // By absolute path: a spec builds into the temp folder, which macOS reaches through a symlink.
        sourcemapPathTransform: (relative, map) => resolve(dirname(map), relative),
      },
    },
  },
})
