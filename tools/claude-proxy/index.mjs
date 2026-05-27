import { spawn } from 'node:child_process'

/**
 * Vite dev-server plugin that proxies POST /api/llm/claude/respond to the local
 * `claude` CLI, which uses the user's Claude Max OAuth session. Dev-only - the
 * production static bundle has no server, so LLM bot mode requires either dev
 * mode or a sidecar process exposing the same endpoint.
 *
 * Request:  { system: string, user: string, model: string,
 *             image?: { mediaType: string, data: string } }
 * Response: { response: string }
 *
 * Without `image`: shells out to `claude -p <text> --output-format text` for the
 * simplest possible path. With `image`: switches to
 * `claude -p --input-format stream-json --output-format stream-json --verbose`,
 * pipes Anthropic-shaped content blocks (`{type:"text"}`, `{type:"image"}`) on
 * stdin, and parses the streamed JSON for the final `result` payload.
 *
 * Errors are returned as { error: string } with status 500.
 */
export function claudeProxyPlugin({ route = '/api/llm/claude', binary = 'claude', timeoutMs = 60_000 } = {}) {
  return {
    name: 'studyflow-claude-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(`${route}/respond`, async (req, res, next) => {
        if (req.method !== 'POST') return next()

        let body = ''
        req.setEncoding('utf-8')
        for await (const chunk of req) body += chunk

        let payload
        try {
          payload = JSON.parse(body)
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'invalid JSON body' }))
          return
        }

        const system = typeof payload?.system === 'string' ? payload.system : ''
        const user = typeof payload?.user === 'string' ? payload.user : ''
        const model = typeof payload?.model === 'string' && payload.model.length > 0
          ? payload.model
          : 'claude-haiku-4-5'
        const image = isImagePayload(payload?.image) ? payload.image : undefined

        if (!user.trim()) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'empty `user` prompt' }))
          return
        }

        try {
          const text = image
            ? await runClaudeWithImage(binary, { system, user, model, image }, timeoutMs)
            : await runClaudeText(binary, { system, user, model }, timeoutMs)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ response: text.trim() }))
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          server.config.logger.warn(`[claude-proxy] ${message}`)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: message }))
        }
      })
    },
  }
}

function isImagePayload(value) {
  return value && typeof value === 'object'
    && typeof value.mediaType === 'string' && value.mediaType.length > 0
    && typeof value.data === 'string' && value.data.length > 0
}

function runClaudeText(binary, { system, user, model }, timeoutMs) {
  const combinedPrompt = system ? `${system}\n\n---\n\n${user}` : user
  const args = ['-p', combinedPrompt, '--output-format', 'text', '--model', model]
  return spawnAndCollect(binary, args, undefined, timeoutMs)
    .then(({ stdout }) => stdout)
}

function runClaudeWithImage(binary, { system, user, model, image }, timeoutMs) {
  // Stream-json mode is the only way the CLI accepts inline base64 image content.
  // System prompt is merged into the user text since the CLI's stream-json input
  // shape only carries user-role messages.
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
  ]
  const combinedText = system ? `${system}\n\n---\n\n${user}` : user
  const streamInput = JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: combinedText },
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
      ],
    },
  }) + '\n'

  return spawnAndCollect(binary, args, streamInput, timeoutMs)
    .then(({ stdout }) => extractStreamJsonResult(stdout))
}

/** Walk newline-delimited JSON from `claude -p --output-format stream-json`
 *  and return the `result` field of the final `{type:"result"}` line. */
function extractStreamJsonResult(stdout) {
  let result = ''
  let errorMessage = ''
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed
    try { parsed = JSON.parse(trimmed) } catch { continue }
    if (parsed?.type === 'result' && typeof parsed.result === 'string') {
      result = parsed.result
      if (parsed.is_error) errorMessage = parsed.result
    }
  }
  if (errorMessage) throw new Error(`claude returned error: ${errorMessage}`)
  if (!result) throw new Error('claude stream-json produced no `result` line')
  return result
}

function spawnAndCollect(binary, args, stdinPayload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const stdioIn = stdinPayload ? 'pipe' : 'ignore'
    const child = spawn(binary, args, { stdio: [stdioIn, 'pipe', 'pipe'] })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`failed to spawn ${binary}: ${err.message}`))
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) return resolve({ stdout, stderr })
      reject(new Error(`${binary} exited ${code}: ${stderr.trim() || stdout.trim() || '(no output)'}`))
    })

    if (stdinPayload) {
      child.stdin.write(stdinPayload)
      child.stdin.end()
    }
  })
}
