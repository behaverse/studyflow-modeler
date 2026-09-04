import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import { embedStudyflowIntoPng } from '@core/document';
import { asXml, asYaml, readSource, type StudyflowSource } from '@cli/studyfile';

/* `studyflow convert`, specified in packages/cli/README.md. */

type TargetFormat = 'yaml' | 'xml' | 'png';

function targetFormat(path: string): TargetFormat {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'png';
  if (ext === '.xml' || ext === '.bpmn') return 'xml';
  if (ext === '.yaml' || ext === '.yml' || ext === '.studyflow') return 'yaml';
  throw new Error(`Cannot tell the target format from "${path}" — use .studyflow/.yaml, .bpmn/.xml, or .studyflow.png.`);
}

export type ConvertOptions = {
  /** For a PNG target: the image to embed into (defaults to the output file itself, or the input if it is a PNG). */
  into?: string;
  /** For a PNG target: draw the image by driving the modeler instead of reusing one. */
  modeler?: boolean;
  origin?: string;
};

/* Rendering is repo-bound: it needs the modeler's dev server, `@playwright/test`, and network for icon glyphs. */

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
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  child.kill();
  throw new Error('Timed out waiting for the dev server.');
}

async function openStudyflow(page: any, origin: string, name: string, xml: string): Promise<void> {
  await page.goto(`${origin}/app`);
  await page.getByTestId('modeler-ready').waitFor({ state: 'attached', timeout: 60_000 });

  await page.getByTestId('open-file-input').setInputFiles({
    name,
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  });
  // The import is done once the canvas holds the studyflow's own elements (`.sf-shape` is the per-element `<g>`).
  await page.locator('.sf-shape').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500); // let icon <foreignObject>s settle before the export
}

/** Export the open diagram as PNG (its studyflow always embedded) and return the bytes. */
async function exportPng(page: any): Promise<Buffer> {
  await page.getByRole('button', { name: 'Open command palette' }).click();
  await page.getByRole('dialog').getByText('Save As...', { exact: true }).click();
  await page.getByTestId('save-dialog').waitFor();
  await page.getByTestId('export-format').selectOption('png');

  const download = page.waitForEvent('download');
  await page.getByTestId('save-submit').click();
  return readFileSync(await (await download).path());
}

async function renderPng(input: string, xml: string, origin: string): Promise<Buffer> {
  let chromium: any;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    throw new Error(
      '--modeler needs @playwright/test, which is not installed here — run it from the repo workspace '
      + '(`npm run examples:render` re-renders every shipped example).',
    );
  }

  const stopServer = await startDevServer(origin);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    // Headless Chromium has the File System Access pickers, and a native picker cannot be driven
    // from here. Hiding them puts the Save dialog on its download path, which is what we read.
    await page.addInitScript(() => {
      for (const key of ['showOpenFilePicker', 'showSaveFilePicker']) {
        Object.defineProperty(window, key, { configurable: true, value: undefined });
      }
    });
    await openStudyflow(page, origin, `${basename(input).replace(/\..*$/, '')}.bpmn`, xml);
    return await exportPng(page);
  } finally {
    await browser.close();
    stopServer();
  }
}

export async function convert(input: string, output: string, options: ConvertOptions): Promise<string> {
  const source: StudyflowSource = await readSource(input);
  const format = targetFormat(output);

  if (format === 'yaml') {
    await writeFile(output, await asYaml(source), 'utf8');
    return `Wrote ${output} (studyflow YAML).`;
  }

  if (format === 'xml') {
    await writeFile(output, await asXml(source), 'utf8');
    return `Wrote ${output} (BPMN XML).`;
  }

  if (options.modeler) {
    const png = await renderPng(input, await asXml(source), options.origin ?? 'http://127.0.0.1:4175');
    await writeFile(output, png);
    return `Wrote ${output} (rendered by the modeler).`;
  }

  // PNG without --modeler: embed the studyflow into an existing image.
  const basePath = options.into
    ?? (existsSync(output) ? output : source.container === 'png' ? input : undefined);
  if (!basePath) {
    throw new Error(
      'A .studyflow.png target needs an image: pass --modeler to draw one, '
      + 'or --into <png> to embed into an existing image.',
    );
  }
  const png = new Uint8Array(await readFile(basePath));
  await writeFile(output, embedStudyflowIntoPng(png, await asXml(source)));
  return `Wrote ${output} (embedded studyflow into ${basePath === output ? 'the existing image' : basePath}).`;
}
