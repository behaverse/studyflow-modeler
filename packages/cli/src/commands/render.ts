import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Re-renders examples to `<name>.studyflow.png` (the diagram embedded in the
 * picture) by driving the real modeler through a headless Chromium. Repo-bound:
 * it starts the modeler's dev server and needs `@playwright/test` installed
 * (both true of a workspace checkout). Needs network for icon glyphs.
 */

export type RenderOptions = {
  dir: string;
  origin: string;
};

async function serverIsUp(origin: string): Promise<boolean> {
  try {
    return (await fetch(`${origin}/app`)).ok;
  } catch {
    return false;
  }
}

/** Start the modeler's vite unless one is already listening; returns a stop function. */
async function startDevServer(origin: string): Promise<() => void> {
  if (await serverIsUp(origin)) return () => {};

  const { hostname, port } = new URL(origin);
  const child = spawn(
    'npm',
    ['run', 'dev', '-w', '@behaverse/studyflow-modeler', '--', '--host', hostname, '--port', port],
    { stdio: 'ignore' },
  );

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await serverIsUp(origin)) return () => child.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill();
  throw new Error('Timed out waiting for the dev server.');
}

/** An example filename's stem: `agent_eval.studyflow.png` -> `agent_eval`. */
const stemOf = (filename: string): string =>
  filename.replace(/\.studyflow\.(png|yaml)$|\.studyflow$|\.png$/, '');

type Source = { file: string; path: string; mimeType: string };

/** The file an example is rendered from: its YAML if present (either spelling), else its PNG. */
function sourceOf(dir: string, stem: string): Source {
  for (const [suffix, mimeType] of [
    ['.studyflow.yaml', 'application/yaml'],
    ['.studyflow', 'application/yaml'],
    ['.studyflow.png', 'image/png'],
    ['.png', 'image/png'],
  ] as const) {
    const file = `${stem}${suffix}`;
    const filePath = path.join(dir, file);
    if (existsSync(filePath)) return { file, path: filePath, mimeType };
  }
  throw new Error(`No source found for example "${stem}".`);
}

async function openExample(page: any, origin: string, source: Source): Promise<void> {
  await page.goto(`${origin}/app`);
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
async function exportPng(page: any): Promise<Buffer> {
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

export async function render(only: string[], options: RenderOptions): Promise<void> {
  let chromium: any;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    throw new Error(
      'render needs @playwright/test, which is not installed here — run it from the repo workspace (`npm run examples:render`).',
    );
  }

  const dir = path.resolve(options.dir);
  const stems = [...new Set(
    readdirSync(dir)
      .filter((f) => /\.studyflow(\.yaml|\.png)?$|\.png$/.test(f))
      .map(stemOf),
  )]
    .filter((stem) => only.length === 0 || only.includes(stem))
    .sort();

  if (stems.length === 0) {
    throw new Error(only.length ? `No examples matched: ${only.join(', ')}` : `No examples found in ${dir}.`);
  }

  const stopServer = await startDevServer(options.origin);
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    for (const stem of stems) {
      const source = sourceOf(dir, stem);
      process.stdout.write(`${stem} ... `);
      try {
        await openExample(page, options.origin, source);
        const png = await exportPng(page);
        writeFileSync(path.join(dir, `${stem}.studyflow.png`), png);
        const from = source.file.endsWith('.studyflow') ? ' (from .studyflow — delete it once happy)'
          : source.file === `${stem}.png` ? ' (from bare .png — delete it once happy)' : '';
        console.log(`${(png.length / 1024).toFixed(0)} KB${from}`);
      } catch (err) {
        console.log(`failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    }
  } finally {
    await browser.close();
    stopServer();
  }
}
