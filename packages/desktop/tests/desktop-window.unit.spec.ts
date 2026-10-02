import { test, expect } from '@playwright/test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { chromium, openWindow } from '../window';

/** The window `studyflow edit` opens the modeler in: a Chromium's app window, else the default browser. A stand-in
 * for each program it starts writes down what it was given, so no browser opens. */

const PAGE = 'http://127.0.0.1:4174/app';

/** A program at `file` that writes its arguments, a line each, to `<file>.args`, and exits. */
function standIn(file: string): string {
  writeFileSync(file, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$0.args"\n');
  chmodSync(file, 0o755);
  return file;
}

const argsOf = (file: string): string => (existsSync(`${file}.args`) ? readFileSync(`${file}.args`, 'utf8') : '');

test('a Chromium is looked for where each system keeps one, the best first; elsewhere there is none', () => {
  const mac = (app: string) => `/Applications/${app}.app/Contents/MacOS/${app}`;
  const only = (...files: string[]) => (file: string) => files.includes(file);
  expect(chromium('darwin', () => true)).toBe(mac('Google Chrome'));
  expect(chromium('darwin', only(mac('Microsoft Edge'), mac('Brave Browser')))).toBe(mac('Brave Browser'));
  expect(chromium('darwin', () => false)).toBeUndefined();
  // Linux's is on the PATH.
  const [dir] = (process.env.PATH ?? '').split(path.delimiter);
  expect(chromium('linux', only(path.join(dir, 'chromium'), path.join(dir, 'google-chrome')))).toBe(path.join(dir, 'google-chrome'));
  expect(chromium('linux', () => false)).toBeUndefined();
  expect(chromium('win32', () => true)).toBeUndefined();
});

test('the window is the Chromium in its app mode, on a profile of its own, and closing it ends the wait', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studyflow-window-'));
  const app = standIn(path.join(dir, 'chromium'));
  await openWindow(PAGE, () => app);
  expect(argsOf(app).split('\n')).toEqual([
    `--app=${PAGE}`,
    `--user-data-dir=${path.join(homedir(), '.studyflow', 'chromium')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '',
  ]);
  // One that does not start ends it too, rather than leave the edit waiting.
  await openWindow(PAGE, () => path.join(dir, 'missing'));
});

test('with no Chromium the default browser opens the page, and nothing waits for it to close', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studyflow-window-'));
  const opener = standIn(path.join(dir, process.platform === 'darwin' ? 'open' : 'xdg-open'));
  // The opener is found on the PATH: this one, the stand-in's alone.
  const PATH = process.env.PATH;
  process.env.PATH = dir;
  let opened: Promise<void>;
  try {
    opened = openWindow(PAGE, () => undefined);
  } finally {
    process.env.PATH = PATH;
  }
  await expect.poll(() => argsOf(opener)).toBe(`${PAGE}\n`);
  const settled = await Promise.race([opened.then(() => true), new Promise((resolve) => setTimeout(resolve, 100, false))]);
  expect(settled, 'a tab in a browser says nothing when it closes').toBe(false);
});
