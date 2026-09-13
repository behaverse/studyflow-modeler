import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** No registry catches an undispatched handler; a declaration ends in `;`, a dispatch in a comma or brace. */

const SRC = join(process.cwd(), 'packages');
const MODELER = join(SRC, 'modeler/src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === 'node_modules') return [];
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

const sources = walk(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const exportsHandlers = (text: string) => /^export (?:async )?function run[A-Z]/m.test(text);

// A module joins the bus by being listed in `FEATURES`. `commandBus.ts` cannot be imported
// here (`diagram/commands.ts` carries a `?raw` import), so its list is read as text.
const bus = readFileSync(join(MODELER, 'commandBus.ts'), 'utf8');
const imported = new Map(
  [...bus.matchAll(/^import \* as (\w+) from '@modeler\/([\w/]+)';$/gm)].map((m) => [m[1], join(MODELER, `${m[2]}.ts`)]),
);
const featureFiles = (bus.match(/const FEATURES = \[([^\]]*)\]/)?.[1] ?? '')
  .split(',').map((name) => name.trim()).filter(Boolean)
  .flatMap((name) => imported.get(name) ?? []);
const features = sources.filter(({ path }) => featureFiles.includes(path));

const handlers = features.flatMap(({ path, text }) =>
  [...text.matchAll(/^export (?:async )?function (run[A-Z]\w*)/gm)].map((m) => ({
    name: m[1].replace(/^run/, ''),
    path: path.replace(SRC, 'packages'),
  }))
);

const dispatched = new Set(
  sources.flatMap(({ text }) => [...text.matchAll(/type: '([A-Z]\w*)'\s*[,}]/g)].map((m) => m[1]))
);

const declared = new Set(
  features.flatMap(({ text }) => [...text.matchAll(/type: '([A-Z]\w*)'\s*;/g)].map((m) => m[1]))
);

test('every module that exports a command handler is listed in FEATURES', () => {
  const unlisted = sources
    .filter(({ path, text }) => path.startsWith(MODELER) && exportsHandlers(text) && !featureFiles.includes(path))
    .map(({ path }) => path.replace(SRC, 'packages'));

  expect(unlisted, 'modules exporting run<Name> that commandBus.ts never connects').toEqual([]);
});

test('every exported command handler is dispatched somewhere', () => {
  expect(handlers.length, 'the scan finds the handlers FEATURES lists').toBeGreaterThan(20);
  const dead = handlers
    .filter(({ name }) => !dispatched.has(name))
    .map(({ name, path }) => `run${name} (${path})`);

  expect(dead, 'handlers nothing dispatches — delete them, or wire them up').toEqual([]);
});

test('every declared command type has a handler of the same name', () => {
  const names = new Set(handlers.map((h) => h.name));
  const orphans = [...declared].filter((name) => !names.has(name));

  expect(orphans, 'command types with no matching run<Name> handler').toEqual([]);
});
