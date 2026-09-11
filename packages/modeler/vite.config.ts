import { resolve } from 'node:path'
import { createServer, defineConfig, type Plugin } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { openWindow } from '../desktop/edit'
import { ROOT, aliases, define } from '../../vite.shared'

// The browser runner (skills/browser) is its own Vite app, served by this dev server under its paths, so dev is
// one origin on one port, exactly as the merged dist/ is in production (the diagram hand-off rides on same-origin
// localStorage). Its config runs in middleware mode here; HMR shares this server's socket, under /run/.
const RUNNER_ROOT = resolve(ROOT, 'skills/browser')
// /api: the dev endpoints the runner's skills serve (the LLM proxy); /run also covers what they mount under it.
const RUNNER_PATHS = ['/run', '/api']
const runner = (): Plugin => ({
  name: 'studyflow:runner',
  apply: 'serve',
  async configureServer(server) {
    const child = await createServer({
      root: RUNNER_ROOT,  // not the cwd this server was started from
      configFile: resolve(RUNNER_ROOT, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: { server: server.httpServer! } },
    })
    server.httpServer!.on('close', () => { child.close() })
    server.middlewares.use((req, res, next) => (
      RUNNER_PATHS.some((path) => req.url?.startsWith(path)) ? child.middlewares(req, res, next) : next()
    ))
  },
})

// `npm run dev:desktop` (`--mode desktop`): this server opened the way `studyflow edit` opens dist/, in a Chromium's app
// window, and closed with it. The page styles itself as the desktop app there (assets/css/desktop.css).
const desktop = (): Plugin => ({
  name: 'studyflow:desktop',
  apply: 'serve',
  configureServer(server) {
    server.httpServer!.once('listening', () => {
      const address = server.httpServer!.address()
      const port = typeof address === 'object' && address ? address.port : server.config.server.port
      openWindow(`http://localhost:${port}/app.html`).then(() => server.close())
    })
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: '',  // relative
  define,
  plugins: [
    tailwindcss(),
    react(),
    runner(),
    mode === 'desktop' && desktop(),
  ],
  resolve: { alias: aliases },
  server: {
    port: 5173,
    fs: { allow: [ROOT] },
  },
  build: {
    outDir: '../../dist',
    // The runner writes dist/run: the root `build` clears dist/ once, so the order of the two builds does not matter.
    emptyOutDir: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        modeler: resolve(import.meta.dirname, 'app.html'),
      },
    },
  },
}))
