import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';

/* The static server behind `studyflow edit`. Apart for the tests: `edit.ts` reads `import.meta`, which they cannot load. */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.studyflow': 'text/yaml; charset=utf-8',
  '.bpmn': 'application/xml',
  '.xml': 'application/xml',
};

/** The file `urlPath` names under `root`, the way a static host resolves it: a file as is, `/app` as `app.html`,
 * a directory as its `index.html`. Nothing outside `root`. */
export function resolveFile(root: string, urlPath: string): { file: string } | { redirect: string } | undefined {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return undefined; // a malformed escape, like /%E0%A4%A: not found, rather than a URIError that ends the server
  }
  const file = path.resolve(root, `.${rel}`);
  if (file !== root && !file.startsWith(root + path.sep)) return undefined;
  const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
  if (isFile(file)) return { file };
  // Not for the root itself, whose `.html` is the file beside it.
  if (file !== root && isFile(`${file}.html`)) return { file: `${file}.html` };
  if (isFile(path.join(file, 'index.html'))) {
    // Relative asset URLs in an index resolve against its directory, so the directory needs its trailing slash.
    // Named by its path under root, not the request's, whose `//evil.com/%2e%2e%2frun` would send the browser to
    // another host; re-encoded, as a newline or a char past Latin-1 in a header throws.
    const location = file.slice(root.length).split(path.sep).map(encodeURIComponent).join('/');
    return rel.endsWith('/') ? { file: path.join(file, 'index.html') } : { redirect: `${location}/` };
  }
  return undefined;
}

/** What a served path holds besides `root`'s files: a file anywhere on disk, read afresh per request, or text. */
export type Served = string | { text: string; type: string };

/** The served file's mtime in ms, on every read and write of it: the modeler links the file it opened when it sees
 * this, saves back with a PUT, and compares it to tell a change made elsewhere. */
export const MODIFIED_HEADER = 'x-studyflow-modified';

/** A write comes from this server's own page: its Host is the address it listens on, and its Origin (which a browser
 * always sends with a PUT) is that same host. A page elsewhere, or one on a rebound DNS name, cannot write. */
function fromOwnPage(request: IncomingMessage, server: Server): boolean {
  const address = server.address();
  if (typeof address !== 'object' || !address) return false;
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  const own = [`${host}:${address.port}`, `localhost:${address.port}`];
  const origin = request.headers.origin;
  return own.includes(request.headers.host ?? '') && (origin === undefined || origin === `http://${request.headers.host}`);
}

/** Overwrite the served file with the request's body, in place, so it keeps its name, its format and its inode. */
function writeServed(file: string, request: IncomingMessage, response: ServerResponse): void {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    try {
      writeFileSync(file, Buffer.concat(chunks));
      response.writeHead(204, { [MODIFIED_HEADER]: String(statSync(file).mtimeMs) }).end();
    } catch (err) {
      response.writeHead(500, { 'content-type': 'text/plain' }).end(err instanceof Error ? err.message : String(err));
    }
  });
}

/** A static server over `root`, listening on `host:port` (port 0 picks a free one). `files` maps extra URL paths
 * to files anywhere on disk (the study `studyflow edit <file>` opens, which a PUT from the page writes back), or to text
 * (the skills installed beside it). */
export function serveUi(root: string, host = '127.0.0.1', port = 0, files: Record<string, Served> = {}): Promise<Server> {
  root = path.resolve(root);
  const server = createServer((request, response) => {
    const urlPath = (request.url ?? '/').split('?')[0];
    const extra = files[urlPath];
    if (extra !== undefined && typeof extra !== 'string') {
      response.writeHead(200, { 'content-type': extra.type }).end(extra.text);
      return;
    }
    if (request.method === 'PUT') {
      if (typeof extra === 'string' && fromOwnPage(request, server)) writeServed(extra, request, response);
      else response.writeHead(403, { 'content-type': 'text/plain' }).end('Not writable');
      return;
    }
    const hit = extra !== undefined ? { file: extra } : resolveFile(root, urlPath);
    if (!hit) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    if ('redirect' in hit) {
      response.writeHead(301, { location: hit.redirect }).end();
      return;
    }
    response.setHeader('content-type', MIME[path.extname(hit.file)] ?? 'application/octet-stream');
    if (extra !== undefined) {
      try {
        response.setHeader(MODIFIED_HEADER, String(statSync(hit.file).mtimeMs));
        response.setHeader('cache-control', 'no-store');
      } catch { /* gone: the read below answers 404 */ }
    }
    createReadStream(hit.file)
      .on('error', () => {
        // Gone since it was found (the study renamed in Finder, dist/ rebuilt under the app): not found, rather than
        // an unhandled 'error' that ends the server. Once the headers are out, all that is left is to cut it short.
        if (response.headersSent) response.destroy();
        else response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      })
      .pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
