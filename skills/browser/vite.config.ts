import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { ROOT, aliases, define } from '../../vite.shared'

/** What skills add to this dev server: each `skills/<name>/browser/vite.ts`'s `devPlugins()` (behaverse: its Unity
 * build and the LLM proxy). The template-literal import is one esbuild resolves at config bundling, for every match. */
async function skillDevPlugins(): Promise<Plugin[]> {
  const skills = readdirSync(resolve(ROOT, 'skills')).filter((name) => existsSync(resolve(ROOT, 'skills', name, 'browser/vite.ts')))
  const modules = await Promise.all(skills.map((name) => import(`../${name}/browser/vite.ts`)))
  return modules.flatMap((module: { devPlugins(): Plugin[] }) => module.devPlugins())
}

// https://vite.dev/config/
export default defineConfig(async ({ command }) => ({
  // Deployed the app lives under <site>/run/ (the root build merges it into dist/run), so built asset URLs stay
  // relative; in dev the same /run/ prefix is where the modeler's dev server hosts this one (its `runner` plugin).
  base: command === 'serve' ? '/run/' : '',
  define,
  plugins: [
    tailwindcss(),
    react(),
    ...(command === 'serve' ? await skillDevPlugins() : []),
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
