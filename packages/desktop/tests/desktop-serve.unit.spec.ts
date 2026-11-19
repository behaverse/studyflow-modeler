import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recentFiles, serveRecent } from '../recent';
import { MODIFIED_HEADER, resolveFile, serveUi, type Served } from '../serve';

/** `studyflow ui` serves dist/ the way a static host does: `/app` is app.html, `/run/` is run/index.html,
 * `/run` redirects to it (its relative assets need the slash), and nothing outside the root is reachable. */

/** Any redirect status: the location is the behaviour. */
const REDIRECT = /^30[1278]$/;

const root = join(mkdtempSync(join(tmpdir(), 'studyflow-ui-')), 'dist');
mkdirSync(root);
writeFileSync(`${root}.html`, 'beside the root, not in it: `/` never serves this');
writeFileSync(join(root, 'index.html'), '<a href="app">Modeler</a>');
writeFileSync(join(root, 'app.html'), '<title>modeler</title>');
mkdirSync(join(root, 'run'));
writeFileSync(join(root, 'run', 'index.html'), '<title>runner</title>');
mkdirSync(join(root, 'π'));
writeFileSync(join(root, 'π', 'index.html'), '');

test('resolves like a static host', () => {
  expect(resolveFile(root, '/')).toEqual({ file: join(root, 'index.html') });
  expect(resolveFile(root, '/app')).toEqual({ file: join(root, 'app.html') });
  expect(resolveFile(root, '/app?study=x')).toEqual({ file: join(root, 'app.html') });
  expect(resolveFile(root, '/run')).toEqual({ redirect: '/run/' });
  expect(resolveFile(root, '/run/')).toEqual({ file: join(root, 'run', 'index.html') });
  expect(resolveFile(root, '/missing')).toBeUndefined();
  expect(resolveFile(root, '/../../etc/passwd')).toBeUndefined();
  expect(resolveFile(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeUndefined();
  expect(resolveFile(root, '/%E0%A4%A')).toBeUndefined();
  // A redirect names the directory found, not the path asked, whose `//host` would leave the origin; re-encoded, as
  // a newline or a char past Latin-1 in a header throws.
  expect(resolveFile(root, '//evil.com/%2e%2e%2frun')).toEqual({ redirect: '/run/' });
  expect(resolveFile(root, '/x%0A/../run')).toEqual({ redirect: '/run/' });
  expect(resolveFile(root, '/.')).toEqual({ redirect: '/' });
  expect(resolveFile(root, '/%CF%80')).toEqual({ redirect: '/%CF%80/' });
});

test('serves over http, and serves the file `studyflow ui <file>` opens, reading it afresh, and the text it is given', async () => {
  const study = join(root, 'my study.studyflow');
  writeFileSync(study, 'id: one');
  const server = await serveUi(root, '127.0.0.1', 0, {
    '/open/my%20study.studyflow': study,
    '/installed-skills.json': { text: '[{"skill":"lab"}]', type: 'application/json' },
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  try {
    // A malformed escape is not found, and the server still answers what follows.
    expect((await fetch(`${origin}/%E0%A4%A`)).status).toBe(404);
    // Nor does redirecting a path that decodes to a newline end it.
    expect(String((await fetch(`${origin}/x%0A%2F..%2Frun`, { redirect: 'manual' })).status)).toMatch(REDIRECT);
    const app = await fetch(`${origin}/app`);
    expect(app.status).toBe(200);
    expect(app.headers.get('content-type')).toContain('text/html');
    expect(await app.text()).toContain('modeler');
    const run = await fetch(`${origin}/run`, { redirect: 'manual' });
    expect(String(run.status)).toMatch(REDIRECT);
    expect(run.headers.get('location')).toBe('/run/');
    expect((await fetch(`${origin}/nope`)).status).toBe(404);

    expect(await (await fetch(`${origin}/open/my%20study.studyflow`)).text()).toBe('id: one');
    writeFileSync(study, 'id: two');
    expect(await (await fetch(`${origin}/open/my%20study.studyflow?x=1`)).text()).toBe('id: two');
    // Renamed since (in Finder, say): not found, and the server still answers.
    renameSync(study, join(root, 'renamed.studyflow'));
    expect((await fetch(`${origin}/open/my%20study.studyflow`)).status).toBe(404);
    expect((await fetch(`${origin}/app`)).status).toBe(200);
    // The installed skills' schemas, as the modeler reads them.
    const installed = await fetch(`${origin}/installed-skills.json`);
    expect(installed.headers.get('content-type')).toBe('application/json');
    expect(await installed.json()).toEqual([{ skill: 'lab' }]);
  } finally {
    server.close();
  }
});

/** A PUT as a page on a DNS name rebound to this machine sends it: its own Host and Origin. `fetch` sets no Host. */
const rebound = (origin: string, path: string): Promise<number | undefined> => new Promise((resolve, reject) => {
  const headers = { host: 'evil.com', origin: 'http://evil.com' };
  request(`${origin}${path}`, { method: 'PUT', headers }, (response) => resolve(response.resume().statusCode))
    .on('error', reject)
    .end('id: two');
});

test('takes a write of the file it opens, and the word that it was opened or is to be forgotten, from its own page and from nowhere else', async () => {
  const study = join(root, 'saved.studyflow.yaml');
  writeFileSync(study, 'id: one');
  const heard: string[] = [];
  const files: Record<string, Served> = {
    '/open/saved.studyflow.yaml': study,
    '/list.json': { text: '[]', type: 'application/json', forget: () => heard.push('forget') },
    '/kept.json': { text: '[]', type: 'application/json' },
  };
  const server = await serveUi(root, '127.0.0.1', 0, files, (file) => heard.push(file));
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const put = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${origin}${path}`, { method: 'PUT', body: 'id: two', headers: { origin, ...headers } });
  const say = (method: string, path: string, from = origin) => fetch(`${origin}${path}`, { method, headers: { origin: from } }).then((response) => response.status);
  try {
    // A POST of the file's path says the page opened it; a DELETE forgets a text that says how. Neither changes the file.
    expect(await say('POST', '/open/saved.studyflow.yaml')).toBe(204);
    expect(await say('DELETE', '/list.json')).toBe(204);
    expect(await say('POST', '/open/saved.studyflow.yaml', 'http://evil.com')).toBe(403);
    expect(await say('DELETE', '/list.json', 'http://evil.com')).toBe(403);
    expect(await say('DELETE', '/kept.json')).toBe(403);
    expect(await say('DELETE', '/open/saved.studyflow.yaml')).toBe(403);
    expect(await say('POST', '/app.html')).toBe(403);
    expect(heard).toEqual([study, 'forget']);
    expect(readFileSync(study, 'utf8')).toBe('id: one');

    const read = await fetch(`${origin}/open/saved.studyflow.yaml`);
    expect(Number(read.headers.get(MODIFIED_HEADER))).toBeGreaterThan(0);

    const written = await put('/open/saved.studyflow.yaml');
    expect(written.status).toBe(204);
    expect(readFileSync(study, 'utf8')).toBe('id: two');
    expect(written.headers.get(MODIFIED_HEADER)).toBeTruthy();

    writeFileSync(study, 'id: one');
    // Another site's page, a rebound DNS name, and anything but the opened file are refused.
    expect((await put('/open/saved.studyflow.yaml', { origin: 'http://evil.com' })).status).toBe(403);
    expect(await rebound(origin, '/open/saved.studyflow.yaml')).toBe(403);
    expect((await put('/app.html')).status).toBe(403);
    expect(readFileSync(study, 'utf8')).toBe('id: one');
    expect(readFileSync(join(root, 'app.html'), 'utf8')).toBe('<title>modeler</title>');
  } finally {
    server.close();
  }
});

test('the files `studyflow ui` opened are served again at a path each, listed newest first, and forgotten at the page\'s word', async () => {
  const home = mkdtempSync(join(tmpdir(), 'studyflow-home-'));
  const kept = process.env.STUDYFLOW_HOME;
  process.env.STUDYFLOW_HOME = home;
  try {
    const study = (name: string) => {
      const file = join(home, name);
      writeFileSync(file, `id: ${name}`);
      return file;
    };
    const [a, b, gone] = [study('a.studyflow.yaml'), study('b study.studyflow.yaml'), study('gone.studyflow.yaml')];
    // Three launches: each opens its file as the first of the list, at a path the page reads.
    expect(serveRecent({}, gone).url).toBe('/recent/0/gone.studyflow.yaml');
    serveRecent({}, a);
    renameSync(gone, join(home, 'moved.studyflow.yaml'));
    const files: Record<string, Served> = {};
    const { url, reopened } = serveRecent(files, b);
    expect(url).toBe('/recent/0/b%20study.studyflow.yaml');

    const server = await serveUi(root, '127.0.0.1', 0, files, reopened);
    const address = server.address();
    const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const list = async () => (await (await fetch(`${origin}/recent.json`)).json() as { url: string; name: string }[]).map(({ url: path, name }) => `${path} ${name}`);
    try {
      // The file that is no longer there is left out.
      expect(await list()).toEqual(['/recent/0/b%20study.studyflow.yaml b study.studyflow.yaml', '/recent/1/a.studyflow.yaml a.studyflow.yaml']);
      expect(await (await fetch(`${origin}/recent/1/a.studyflow.yaml`)).text()).toBe('id: a.studyflow.yaml');
      // The page opens the older one again: it leads the list, here and for the next launch, at the path it had.
      expect((await fetch(`${origin}/recent/1/a.studyflow.yaml`, { method: 'POST', headers: { origin } })).status).toBe(204);
      expect(await list()).toEqual(['/recent/1/a.studyflow.yaml a.studyflow.yaml', '/recent/0/b%20study.studyflow.yaml b study.studyflow.yaml']);
      expect(recentFiles().map((file) => file.path)).toEqual([a, b]);
      // Forgotten, the list is empty, and a file still open in the page is still read and written.
      expect((await fetch(`${origin}/recent.json`, { method: 'DELETE', headers: { origin } })).status).toBe(204);
      expect(await list()).toEqual([]);
      expect(recentFiles()).toEqual([]);
      expect((await fetch(`${origin}/recent/0/b%20study.studyflow.yaml`)).status).toBe(200);
    } finally {
      server.close();
    }
    // No more are kept than the New dialog lists.
    for (let n = 0; n < 7; n += 1) serveRecent({}, study(`${n}.studyflow.yaml`));
    expect(recentFiles().map((file) => file.path.split('/').pop())).toEqual(['6', '5', '4', '3', '2'].map((n) => `${n}.studyflow.yaml`));
  } finally {
    if (kept === undefined) delete process.env.STUDYFLOW_HOME;
    else process.env.STUDYFLOW_HOME = kept;
  }
});
