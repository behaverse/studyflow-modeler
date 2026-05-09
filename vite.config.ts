import { resolve, dirname, extname, normalize, sep } from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

const pkg = JSON.parse(fs.readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.symbols.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
}

function unityBuildPlugin(mountPath: string, buildDir: string): Plugin {
  return {
    name: 'unity-build-static',
    configureServer(server) {
      if (!fs.existsSync(buildDir)) {
        server.config.logger.warn(
          `[unity-build] ${buildDir} not found. Set UNITY_BUILD_PATH or build the WebGL player.`,
        )
      }
      server.middlewares.use(mountPath, (req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
        const rel = urlPath === '/' ? '/index.html' : urlPath
        const target = normalize(resolve(buildDir, '.' + rel))
        if (!target.startsWith(buildDir + sep) && target !== buildDir) {
          res.statusCode = 403
          res.end('forbidden')
          return
        }
        fs.stat(target, (err, stat) => {
          if (err || !stat.isFile()) return next()
          // Strip Unity compression suffixes for content-type lookup, but emit
          // the matching Content-Encoding so the browser decompresses natively.
          let lookupName = target
          if (target.endsWith('.gz')) {
            res.setHeader('Content-Encoding', 'gzip')
            lookupName = target.slice(0, -3)
          } else if (target.endsWith('.br')) {
            res.setHeader('Content-Encoding', 'br')
            lookupName = target.slice(0, -3)
          }
          const ext = extname(lookupName).toLowerCase()
          res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
          res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
          fs.createReadStream(target).pipe(res)
        })
      })
    },
  }
}

const unityBuildPath = process.env.UNITY_BUILD_PATH
  ? resolve(process.env.UNITY_BUILD_PATH)
  : resolve(__dirname, '../assessment-unity/Build/WebGL')

// https://vite.dev/config/
export default defineConfig({
  root: './src',
  publicDir: false, // disable public directory
  base: '',  // relative base
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(pkg.version),
  },
  plugins: [
    tailwindcss(),
    react(),
    unityBuildPlugin('/assessment-unity', unityBuildPath),
  ],
  css: {
    postcss: {
      plugins: [],
    }
  },
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, 'src') },
      { find: '#root', replacement: resolve(__dirname) }
    ],
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000, // increase chunk size warning limit
    rollupOptions: {
      input: {
        main: resolve(__dirname, './src/index.html'),
        modeler: resolve(__dirname, './src/app.html'),
        runtime: resolve(__dirname, './src/run.html'),
      }
    },

  },
  assetsInclude: [
    '**/*.png', '**/*.bpmn', '**/*.studyflow', '**/*.jpeg', '**/*.gif',
    '**/*.svg', '**/*.ico', '**/*.webp', '**/*.yaml'],
})
