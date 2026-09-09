import { resolve, dirname, extname, normalize, sep } from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'
import type { Plugin } from 'vite'
import { claudeProxyPlugin } from './llm/claude-proxy/index.mjs'

/** What the browser runner's dev server adds for this skill: the Unity WebGL build under `/run/assessment-unity`
 * (from `UNITY_BUILD_PATH`, or the repo's `run/assessment-unity/Build/WebGL`) and the Claude proxy the LLM bot calls. */

const __dirname = dirname(fileURLToPath(import.meta.url))

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
          // Strip Unity compression suffixes for content-type lookup; emit matching Content-Encoding.
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
  : resolve(__dirname, '../../../run/assessment-unity/Build/WebGL')

export function behaverseDevPlugins(): Plugin[] {
  return [unityBuildPlugin('/run/assessment-unity', unityBuildPath), claudeProxyPlugin()]
}
