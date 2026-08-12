/**
 * `npm run examples:render [names...]` — re-renders each example to `<name>.studyflow.png` (the
 * diagram is embedded in the picture) by driving the real modeler. Needs network for icon glyphs.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES_DIR = path.join(ROOT, 'src/assets/examples');
const ORIGIN = 'http://127.0.0.1:4174';

async function serverIsUp() {
  try {
    return (await fetch(`${ORIGIN}/app`)).ok;
  } catch {
    return false;
  }
}

/** Start `vite` unless one is already listening; returns a stop function. */
async function startDevServer() {
  if (await serverIsUp()) return () => {};

  const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4174'], {
    cwd: ROOT,
    stdio: 'ignore',
  });

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await serverIsUp()) return () => child.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill();
  throw new Error('Timed out waiting for the dev server.');
}

/** An example filename's stem: `agent_eval.studyflow.png` -> `agent_eval`. */
const stemOf = (filename) =>
  filename.replace(/\.studyflow\.(png|yaml)$|\.studyflow$|\.png$/, '');

/** The file an example is rendered from: its YAML if present (either spelling), else its PNG. */
function sourceOf(stem) {
  for (const [suffix, mimeType] of [
    ['.studyflow.yaml', 'application/yaml'],
    ['.studyflow', 'application/yaml'],
    ['.studyflow.png', 'image/png'],
    ['.png', 'image/png'],
  ]) {
    const file = `${stem}${suffix}`;
    const filePath = path.join(EXAMPLES_DIR, file);
    if (existsSync(filePath)) return { file, path: filePath, mimeType };
  }
  throw new Error(`No source found for example "${stem}".`);
}

async function openExample(page, source) {
  await page.goto(`${ORIGIN}/app`);
  await page.getByTestId('modeler-ready').waitFor({ state: 'attached', timeout: 60_000 });

  await page.getByTestId('open-file-input').setInputFiles({
    name: source.file,
    mimeType: source.mimeType,
    buffer: readFileSync(source.path),
  });
  // The import is done once the canvas holds the example's own elements.
  await page.locator('.djs-element').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500); // let icon <foreignObject>s settle before saveSVG
}

/** Export the open diagram as PNG (studyflow embedded, draw.io payload off) and return the bytes. */
async function exportPng(page) {
  await page.getByRole('button', { name: 'Open command palette' }).click();
  await page.getByRole('dialog').getByText('Export...', { exact: true }).click();
  await page.getByTestId('export-dialog').waitFor();
  await page.getByTestId('export-format').selectOption('png');

  const drawio = page.getByRole('switch', { name: 'Embed draw.io diagram' });
  if ((await drawio.getAttribute('aria-checked')) !== 'false') await drawio.click();

  const download = page.waitForEvent('download');
  await page.getByTestId('export-submit').click();
  return readFileSync(await (await download).path());
}

const only = process.argv.slice(2);
const stems = [...new Set(
  readdirSync(EXAMPLES_DIR)
    .filter((f) => /\.studyflow(\.yaml|\.png)?$|\.png$/.test(f))
    .map(stemOf),
)]
  .filter((stem) => only.length === 0 || only.includes(stem))
  .sort();

if (stems.length === 0) {
  console.error(only.length ? `No examples matched: ${only.join(', ')}` : 'No examples found.');
  process.exit(1);
}

const stopServer = await startDevServer();
const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  for (const stem of stems) {
    const source = sourceOf(stem);
    process.stdout.write(`${stem} ... `);
    try {
      await openExample(page, source);
      const png = await exportPng(page);
      writeFileSync(path.join(EXAMPLES_DIR, `${stem}.studyflow.png`), png);
      const from = source.file.endsWith('.studyflow') ? ' (from .studyflow — delete it once happy)'
        : source.file === `${stem}.png` ? ' (from bare .png — delete it once happy)' : '';
      console.log(`${(png.length / 1024).toFixed(0)} KB${from}`);
    } catch (err) {
      console.log(`failed: ${err.message}`);
      process.exitCode = 1;
    }
  }
} finally {
  await browser.close();
  stopServer();
}
