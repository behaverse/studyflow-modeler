import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import { embedPastedImagesIntoPng, embedPastedImagesIntoTiff, embedStudyflowIntoPng, embedStudyflowIntoTiff, encodeTiff, replaceStudyflowInSvg } from '@core/document';
import { pngRaster } from '@cli/pixels';
import { asXml, asYaml, parseSource, readSource, tiffAbout, type StudyflowSource } from '@cli/studyfile';

/* `studyflow convert`: between .studyflow(.yaml), .bpmn/.xml, .studyflow.png, .studyflow.svg and .studyflow.tif, the format told by the extension. */

type TargetFormat = 'yaml' | 'xml' | 'png' | 'svg' | 'tif';
type ImageFormat = Extract<TargetFormat, 'png' | 'svg' | 'tif'>;

const IMAGES = new Set<TargetFormat>(['png', 'svg', 'tif']);

function targetFormat(path: string): TargetFormat {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'png';
  if (ext === '.svg') return 'svg';
  if (ext === '.tif' || ext === '.tiff') return 'tif';
  if (ext === '.xml' || ext === '.bpmn') return 'xml';
  if (ext === '.yaml' || ext === '.yml' || ext === '.studyflow') return 'yaml';
  throw new Error(`Cannot tell the target format from "${path}" — use .studyflow/.yaml, .bpmn/.xml, .studyflow.png, .studyflow.svg or .studyflow.tif.`);
}

/** A print size, as a TIFF declares one. */
type PrintSize = { dpi: number; mmPerUnit?: number };

/** What a unit of the diagram is on paper unless `--mm-per-unit` says otherwise: the modeler's own default. */
const MM_PER_UNIT = 0.2;
const DPI = 300;

export type ConvertOptions = {
  /** For an image target: the image to embed into (defaults to the output file itself, or the input if it is one of that kind). */
  into?: string;
  /** For an image target: draw the image by driving the modeler instead of reusing one. */
  modeler?: boolean;
  origin?: string;
  /** For a TIFF target: its print size in dots per inch; a PNG's own when re-encoding one, else 300, unless given. */
  dpi?: number;
  /** For a TIFF the modeler draws: what a unit of the diagram is on paper, in mm (0.2 unless given). */
  mmPerUnit?: number;
  /** Write nothing when reading the input raised a warning. */
  strict?: boolean;
};

/* Rendering is repo-bound: it drives the modeler's dev server with `@playwright/test`. */

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

async function openStudyflow(page: any, origin: string, name: string, studyflow: string): Promise<void> {
  await page.goto(`${origin}/app`);
  await page.getByTestId('modeler-ready').waitFor({ state: 'attached', timeout: 60_000 });

  await page.getByTestId('open-file-input').setInputFiles({
    name,
    mimeType: 'text/yaml',
    buffer: Buffer.from(studyflow),
  });
  // The import is done once the canvas holds the studyflow's own elements (`.sf-shape` is the per-element `<g>`).
  await page.locator('.sf-shape').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500); // let icon <foreignObject>s settle before the export
}

/** Export the open diagram as `format` (its studyflow always embedded) and return the bytes. */
async function exportImage(page: any, format: ImageFormat, print: PrintSize): Promise<Buffer> {
  await page.getByRole('button', { name: 'Open command palette' }).click();
  await page.getByRole('dialog').getByText('Save As...', { exact: true }).click();
  await page.getByTestId('save-dialog').waitFor();
  await page.getByTestId('export-format').selectOption(format);
  if (format === 'tif') {
    // The Save dialog asks the print width; it offers the diagram's own at the modeler's unit, and says how many units it is.
    const width = page.getByTestId('export-print-width');
    if (print.mmPerUnit !== undefined) {
      const units = Number(await width.getAttribute('data-units'));
      await width.fill(String(Math.round(units * print.mmPerUnit * 10) / 10));
    }
    await page.getByTestId('export-print-dpi').fill(String(print.dpi));
  }

  const download = page.waitForEvent('download');
  await page.getByTestId('save-submit').click();
  return readFileSync(await (await download).path());
}

async function renderImage(input: string, studyflow: string, origin: string, format: ImageFormat, print: PrintSize): Promise<Buffer> {
  let chromium: any;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    throw new Error(
      '--modeler needs @playwright/test, which is not installed here — run it from the repo workspace.',
    );
  }

  const stopServer = await startDevServer(origin);
  // Playwright's own Chromium when it is installed, else the Chrome on this machine.
  const browser = await chromium.launch().catch((error: unknown) => {
    if (!/Executable doesn't exist/.test(String(error))) throw error;
    return chromium.launch({ channel: 'chrome' });
  });
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
    await openStudyflow(page, origin, `${basename(input).replace(/\..*$/, '')}.studyflow.yaml`, studyflow);
    return await exportImage(page, format, print);
  } finally {
    await browser.close();
    stopServer();
  }
}

/** The print size a re-encoded TIFF declares, and how to say it: `--dpi`, else the PNG's own, else {@link DPI}. */
function printSize(source: StudyflowSource, options: ConvertOptions): { dpi: { x: number; y: number }; said: string } {
  if (options.dpi !== undefined) return { dpi: { x: options.dpi, y: options.dpi }, said: `at ${options.dpi} dpi` };
  const own = source.image?.resolution;
  if (own) return { dpi: own, said: `at its own ${Math.round(own.x * 10) / 10} dpi` };
  return { dpi: { x: DPI, y: DPI }, said: `at ${DPI} dpi, as the PNG declares no print size` };
}

/** `text` and the pasted images in the image `base` holds, or in the PNG's pixels re-encoded as a TIFF. */
async function imageWith(source: StudyflowSource, format: ImageFormat, text: string, base: Uint8Array | string): Promise<Uint8Array | string> {
  if (format === 'svg') return replaceStudyflowInSvg(base as string, text);
  if (format === 'png') return embedPastedImagesIntoPng(embedStudyflowIntoPng(base as Uint8Array, text), source.pastedImages);
  const about = await tiffAbout((await parseSource(source)).model);
  return embedPastedImagesIntoTiff(embedStudyflowIntoTiff(base as Uint8Array, text, about), source.pastedImages);
}

export async function convert(input: string, output: string, options: ConvertOptions): Promise<string> {
  const source: StudyflowSource = await readSource(input);
  const format = targetFormat(output);

  // Reading drops what no loaded schema declares, so say what the reader met, as `validate` does.
  const warnings: string[] = [];
  const onWarning = (warning: string) => { warnings.push(warning); };
  const drawnAs = options.modeler && IMAGES.has(format) ? format as ImageFormat : undefined;
  // Only a PNG or a TIFF keeps the images pasted on a study, and only one this command embeds into or re-encodes
  // rather than one the modeler draws from the text alone.
  const keeps = (format === 'png' || format === 'tif') && !drawnAs;
  const left = keeps || source.pastedImages.size === 0 ? '' : ` The ${source.pastedImages.size} image(s) pasted on it stay in ${input}.`;
  // The modeler draws from the YAML, which a PNG and a TIFF carry too; an SVG carries the XML.
  const text = !drawnAs && (format === 'xml' || format === 'svg') ? await asXml(source, onWarning) : await asYaml(source, onWarning, { pastedImages: keeps });
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (options.strict && warnings.length > 0) throw new Error(`Nothing written to ${output}: reading ${input} raised warnings (--strict).`);

  if (format === 'yaml') {
    await writeFile(output, text, 'utf8');
    return `Wrote ${output} (studyflow YAML).${left}`;
  }

  if (format === 'xml') {
    await writeFile(output, text, 'utf8');
    return `Wrote ${output} (BPMN XML).${left}`;
  }

  if (drawnAs) {
    const print = { dpi: options.dpi ?? DPI, mmPerUnit: options.mmPerUnit };
    const image = await renderImage(input, text, options.origin ?? 'http://127.0.0.1:4175', drawnAs, print);
    await writeFile(output, image);
    const sized = drawnAs === 'tif' ? ` at ${print.dpi} dpi, ${print.mmPerUnit ?? MM_PER_UNIT} mm a unit` : '';
    return `Wrote ${output} (rendered by the modeler${sized}).${left}`;
  }

  // A TIFF from a PNG, without an image to embed into: the PNG's pixels, re-encoded.
  if (format === 'tif' && !options.into && source.container === 'png') {
    const { dpi, said } = printSize(source, options);
    const raster = pngRaster(new Uint8Array(await readFile(input)));
    await writeFile(output, await imageWith(source, format, text, encodeTiff(raster, dpi)));
    const mm = (pixels: number, dots: number) => Math.round((pixels / dots) * 254) / 10;
    return `Wrote ${output} (the pixels of ${input} as an LZW TIFF, ${raster.width} × ${raster.height} px, ${mm(raster.width, dpi.x)} × ${mm(raster.height, dpi.y)} mm ${said}).${left}`;
  }

  // An image without --modeler: embed the studyflow into an existing image of that kind.
  const basePath = options.into
    ?? (existsSync(output) ? output : source.container === format ? input : undefined);
  if (!basePath) {
    const from = format === 'tif' ? ', or convert a .studyflow.png, whose pixels it re-encodes' : '';
    throw new Error(
      `A .studyflow.${format} target needs an image: pass --modeler to draw one, or --into <${format}> to embed into an existing image${from}.`,
    );
  }
  const base = format === 'svg' ? await readFile(basePath, 'utf8') : new Uint8Array(await readFile(basePath));
  await writeFile(output, await imageWith(source, format, text, base));
  return `Wrote ${output} (embedded studyflow into ${basePath === output ? 'the existing image' : basePath}).${left}`;
}
