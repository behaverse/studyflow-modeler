import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { test as base, type Page } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * The `test` every e2e spec takes. Under `npm run coverage` (c8 sets NODE_V8_COVERAGE) it records the JavaScript each
 * Chromium page of the test's context runs, and writes it where c8 reads Node's own, as a script per module the dev
 * server served with the source map it carried, so the report counts the browser's lines toward their sources. A page
 * keeps what it ran across navigations but not across a reload, and a context a test opens itself is not recorded.
 */

const DIR = process.env.NODE_V8_COVERAGE;
const ROOT = process.cwd();
/** What the dev server serves from where: the modeler at its root, the browser runner under /run/. */
const MODELER = path.join(ROOT, 'packages/modeler');
const RUNNER = path.join(ROOT, 'packages/runtime-browser');
const INLINE_MAP = /\n\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/;

type Script = Awaited<ReturnType<Page['coverage']['stopJSCoverage']>>[number];

/** The file a served module was made from: none for the dev server's own modules and the dependencies it bundles. */
function fileOf(url: string): string | undefined {
  const { pathname } = new URL(url);
  if (pathname.includes('/node_modules/')) return undefined;
  const absolute = /^(?:\/run)?\/@fs(\/.*)$/.exec(pathname);
  if (absolute) return decodeURIComponent(absolute[1]);
  if (pathname.startsWith('/@') || pathname.startsWith('/run/@')) return undefined;
  return pathname.startsWith('/run/') ? path.join(RUNNER, pathname.slice('/run/'.length)) : path.join(MODELER, pathname);
}

let written = 0;
function write(scripts: Script[]): void {
  const result: unknown[] = [];
  const maps: Record<string, unknown> = {};
  for (const script of scripts) {
    const file = fileOf(script.url);
    const map = script.source && file ? INLINE_MAP.exec(script.source) : null;
    if (!file || !map) continue;
    const sourceMap = JSON.parse(Buffer.from(map[1], 'base64').toString('utf8'));
    sourceMap.sources = sourceMap.sources.map((source: string) => pathToFileURL(path.resolve(path.dirname(file), source)).href);
    // A name of its own, so c8 never merges it with what Node ran of the same source (a different build of it).
    const url = pathToFileURL(`${file}.browser.js`).href;
    result.push({ scriptId: script.scriptId, url, functions: script.functions });
    maps[url] = { lineLengths: script.source!.split('\n').map((line) => line.length), data: sourceMap };
  }
  if (result.length > 0) writeFileSync(path.join(DIR!, `coverage-browser-${process.pid}-${written++}.json`), JSON.stringify({ result, 'source-map-cache': maps }));
}

const recording = new WeakMap<Page, Promise<boolean>>();

export const test = base.extend({
  context: async ({ context, browserName }, use) => {
    if (!DIR || browserName !== 'chromium') return use(context);
    const pages: Page[] = [];
    const record = (page: Page) => {
      pages.push(page);
      recording.set(page, page.coverage.startJSCoverage({ resetOnNavigation: false }).then(() => true, () => false));
    };
    context.pages().forEach(record);
    context.on('page', record);
    await use(context);
    for (const page of pages) {
      if (!(await recording.get(page)) || page.isClosed()) continue;
      write(await page.coverage.stopJSCoverage().catch(() => []));
    }
  },
  // A test's own page starts recording before the test can load anything into it.
  page: async ({ page }, use) => {
    await recording.get(page);
    await use(page);
  },
});
