import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
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
  const rel = decodeURIComponent(urlPath.split('?')[0]);
  const file = path.resolve(root, `.${rel}`);
  if (file !== root && !file.startsWith(root + path.sep)) return undefined;
  const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
  if (isFile(file)) return { file };
  if (isFile(`${file}.html`)) return { file: `${file}.html` };
  if (isFile(path.join(file, 'index.html'))) {
    // Relative asset URLs in an index resolve against its directory, so the directory needs its trailing slash.
    return rel.endsWith('/') ? { file: path.join(file, 'index.html') } : { redirect: `${rel}/` };
  }
  return undefined;
}

/** A static server over `root`, listening on `host:port` (port 0 picks a free one). `files` maps extra URL paths
 * to files anywhere on disk, read afresh per request (the study `studyflow edit <file>` opens). */
export function serveUi(root: string, host = '127.0.0.1', port = 0, files: Record<string, string> = {}): Promise<Server> {
  root = path.resolve(root);
  const server = createServer((request, response) => {
    const urlPath = (request.url ?? '/').split('?')[0];
    const hit = files[urlPath] ? { file: files[urlPath] } : resolveFile(root, urlPath);
    if (!hit) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    if ('redirect' in hit) {
      response.writeHead(301, { location: hit.redirect }).end();
      return;
    }
    response.writeHead(200, { 'content-type': MIME[path.extname(hit.file)] ?? 'application/octet-stream' });
    createReadStream(hit.file).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
