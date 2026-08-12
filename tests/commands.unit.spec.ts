import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** No registry catches an undispatched handler; a declaration ends in `;`, a dispatch in a comma or brace. */

const SRC = join(process.cwd(), 'packages');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === 'node_modules') return [];
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

const sources = walk(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const commandFiles = sources.filter(({ path }) => /modeler\/src\/[a-zA-Z]+\/commands\.ts$/.test(path));

const handlers = commandFiles.flatMap(({ path, text }) =>
  [...text.matchAll(/^export (?:async )?function (run[A-Z]\w*)/gm)].map((m) => ({
    name: m[1].replace(/^run/, ''),
    path: path.replace(SRC, 'packages'),
  }))
);

const dispatched = new Set(
  sources.flatMap(({ text }) => [...text.matchAll(/type: '([A-Z]\w*)'\s*[,}]/g)].map((m) => m[1]))
);

const declared = new Set(
  commandFiles.flatMap(({ text }) => [...text.matchAll(/type: '([A-Z]\w*)'\s*;/g)].map((m) => m[1]))
);

test('the scan finds the command surface it expects', () => {
  expect(commandFiles.length).toBeGreaterThan(5);
  expect(handlers.length).toBeGreaterThan(20);
  expect(dispatched.size).toBeGreaterThan(20);
});

test('every exported command handler is dispatched somewhere', () => {
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
