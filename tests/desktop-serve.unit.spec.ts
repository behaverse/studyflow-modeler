import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveFile, serveUi } from '../packages/desktop/serve';

/** `studyflow edit` (and `ui`) serves dist/ the way a static host does: `/app` is app.html, `/run/` is run/index.html,
 * `/run` redirects to it (its relative assets need the slash), and nothing outside the root is reachable. */

const root = mkdtempSync(join(tmpdir(), 'studyflow-ui-'));
writeFileSync(join(root, 'index.html'), '<a href="app">Modeler</a>');
writeFileSync(join(root, 'app.html'), '<title>modeler</title>');
mkdirSync(join(root, 'run'));
writeFileSync(join(root, 'run', 'index.html'), '<title>runner</title>');

test('resolves like a static host', () => {
  expect(resolveFile(root, '/')).toEqual({ file: join(root, 'index.html') });
  expect(resolveFile(root, '/app')).toEqual({ file: join(root, 'app.html') });
  expect(resolveFile(root, '/app?study=x')).toEqual({ file: join(root, 'app.html') });
  expect(resolveFile(root, '/run')).toEqual({ redirect: '/run/' });
  expect(resolveFile(root, '/run/')).toEqual({ file: join(root, 'run', 'index.html') });
  expect(resolveFile(root, '/missing')).toBeUndefined();
  expect(resolveFile(root, '/../../etc/passwd')).toBeUndefined();
  expect(resolveFile(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeUndefined();
});

test('serves over http', async () => {
  const server = await serveUi(root);
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  try {
    const app = await fetch(`${origin}/app`);
    expect(app.status).toBe(200);
    expect(app.headers.get('content-type')).toContain('text/html');
    expect(await app.text()).toContain('modeler');
    const run = await fetch(`${origin}/run`, { redirect: 'manual' });
    expect(run.status).toBe(301);
    expect(run.headers.get('location')).toBe('/run/');
    expect((await fetch(`${origin}/nope`)).status).toBe(404);
  } finally {
    server.close();
  }
});

test('serves the file `studyflow edit <file>` opens, reading it afresh', async () => {
  const study = join(root, 'my study.studyflow');
  writeFileSync(study, 'id: one');
  const server = await serveUi(root, '127.0.0.1', 0, { '/open/my%20study.studyflow': study });
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  try {
    expect(await (await fetch(`${origin}/open/my%20study.studyflow`)).text()).toBe('id: one');
    writeFileSync(study, 'id: two');
    expect(await (await fetch(`${origin}/open/my%20study.studyflow?x=1`)).text()).toBe('id: two');
  } finally {
    server.close();
  }
});
