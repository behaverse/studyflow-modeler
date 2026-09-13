import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Download, type Locator, type Page } from '@playwright/test';

import { studyflowToXml, xmlToStudyflow } from '@core/document';
import { extractStudyflowFromPng } from '@core/document/png';

const SKILLS_DIR = path.join(process.cwd(), 'skills');

/**
 * Every shipped example by name: its file less `.studyflow.png` or `.studyflow.yaml`, so a test
 * does not care which one it ships as. The name is also its gallery card's test id.
 */
const examplePaths = new Map<string, string>();
for (const rel of globSync(['*/examples/*.studyflow.png', '*/examples/*.studyflow.yaml'], { cwd: SKILLS_DIR })) {
  const name = path.basename(rel).replace(/\.studyflow\.(png|yaml)$/, '');
  if (examplePaths.has(name)) throw new Error(`Two shipped examples are named "${name}".`);
  examplePaths.set(name, path.join(SKILLS_DIR, rel));
}

/** Example names, sorted — the corpus every example-wide suite iterates. */
export const exampleNames: string[] = [...examplePaths.keys()].sort();

/** Name → the skill it ships with, which is its gallery shelf. */
export const exampleCategories = new Map(
  [...examplePaths].map(([name, file]) => [name, path.basename(path.dirname(path.dirname(file)))]),
);

/** The example's file, whichever kind; `setInputFiles` opens it as the app would. */
export function examplePath(name: string): string {
  const file = examplePaths.get(name);
  if (!file) throw new Error(`No shipped example named "${name}".`);
  return file;
}

export function exampleFile(name: string): Buffer {
  return readFileSync(examplePath(name));
}

/** The blank diagram the app starts from, the same file `NewDiagram` loads. */
export function blankDiagram(): Buffer {
  return readFileSync(path.join(process.cwd(), 'assets/new_diagram.bpmn'));
}

let schemaModdle: Promise<any> | undefined;

/** The example as BPMN XML: what the YAML in its file, or embedded in its PNG, spells. */
export async function exampleXml(name: string): Promise<string> {
  const file = examplePath(name);
  const yaml = file.endsWith('.png') ? extractStudyflowFromPng(readFileSync(file)) : readFileSync(file, 'utf8');
  // Built on first use: most e2e workers never read an example's XML.
  schemaModdle ??= import('./schemas').then(({ freshModdle }) => freshModdle());
  return studyflowToXml(yaml, await schemaModdle);
}

export async function exampleStudyflow(name: string, moddle: any): Promise<string> {
  return xmlToStudyflow(await exampleXml(name), moddle);
}

export function withoutDiagramInterchange(xml: string): string {
  return xml.replace(/\s*<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/g, '');
}

/**
 * Hides the File System Access pickers, the way Firefox, Safari, and every mobile browser do.
 * Playwright cannot drive a native picker, so any test that wants a download needs this.
 */
export async function withoutFileSystemAccess(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const key of ['showOpenFilePicker', 'showSaveFilePicker']) {
      // The methods live on `Window.prototype`, so shadowing is what removes them.
      Object.defineProperty(window, key, { configurable: true, value: undefined });
    }
  });
}

/** `pickers: true` keeps the File System Access pickers, for tests that stub them themselves. */
export async function gotoModeler(page: Page, { pickers = false } = {}): Promise<void> {
  if (!pickers) await withoutFileSystemAccess(page);
  await page.goto('/app');
  await expect(page.getByTestId('modeler-app')).toBeAttached();
  await expect(page.getByTestId('modeler-ready')).toBeAttached({ timeout: 30_000 });
  await expect(page.getByTestId('modeler-canvas')).toBeVisible();
  await expectBackendMounted(page);
}

/**
 * Pin *which* editor actually mounted.
 *
 * The run-time proof that bpmn-js is really gone: diagram-js owns
 * `.djs-container`, the native canvas owns `svg.sf-canvas`, and neither ever
 * renders the other's root. The dependency is gone from `package.json`, but this
 * is the assertion a re-added one would trip — the rest of the suite's selectors
 * are generic enough to pass quietly under either.
 */
export async function expectBackendMounted(page: Page): Promise<void> {
  const canvas = page.getByTestId('modeler-canvas');

  await expect(canvas.locator('svg.sf-canvas'), 'expected the native canvas to be mounted').toBeVisible();
  await expect(canvas.locator('.djs-container'), 'diagram-js must not be mounted at all').toHaveCount(0);
}

/**
 * The in-place label editor: a single `<textarea>` the canvas overlays on the
 * label being edited (`canvas/interaction/labelEditing.ts`). diagram-js used to
 * mount a `contenteditable` div here instead, which is why reading the text went
 * through {@link expectEditorText} rather than `toHaveValue`.
 */
export function labelEditor(page: Page): Locator {
  return page.locator('.sf-label-editor');
}

/** Assert the open label editor's text. */
export async function expectEditorText(page: Page, expected: string): Promise<void> {
  await expect(labelEditor(page)).toHaveValue(expected);
}

export async function pressOnCanvas(page: Page, key: string): Promise<void> {
  await page.getByTestId('modeler-canvas').locator('svg[tabindex]').press(key);
}

export async function openCommandPalette(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open command palette' }).click();
  await expect(page.getByPlaceholder(/Search commands/)).toBeVisible();
}

export async function runPaletteCommand(page: Page, ...labels: string[]): Promise<void> {
  await openCommandPalette(page);
  for (const label of labels) {
    await page.getByRole('dialog').getByText(label, { exact: true }).click();
  }
}

/** "Open File..." now opens a dialog; the picker is behind its Browse button. */
export async function browseForDiagram(page: Page): Promise<void> {
  await runPaletteCommand(page, 'Open File...');
  await expect(page.getByTestId('open-dialog')).toBeVisible();
  await page.getByTestId('open-dropzone').click();
}

export async function exportDiagram(page: Page, format: string): Promise<Download> {
  await runPaletteCommand(page, 'Save As...');
  await expect(page.getByTestId('save-dialog')).toBeVisible();
  await page.getByTestId('export-format').selectOption(format);

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('save-submit').click();
  return downloadPromise;
}

/** Click a tile (by its exact label) inside the currently open palette flyout. */
async function clickPaletteTile(page: Page, label: string): Promise<void> {
  // A flyout can list a BPMN item and a same-named schema extra; BPMN renders first, take the first match.
  const tile = page
    .locator('button:visible')
    .filter({ has: page.locator('span', { hasText: new RegExp(`^${label}$`) }) })
    .first();
  await expect(tile).toBeVisible();
  await tile.click();
}

export async function addPaletteElement(
  page: Page,
  group: string,
  label: string,
  position: { x: number; y: number },
): Promise<void> {
  await page.getByRole('button', { name: group, exact: true }).click();
  await clickPaletteTile(page, label);
  await page.getByTestId('modeler-canvas').click({ position });
}

export async function addSchemaPaletteElement(
  page: Page,
  schemaName: string,
  label: string,
  position: { x: number; y: number },
): Promise<void> {
  await page.getByRole('button', { name: `${schemaName} elements...` }).click();
  await clickPaletteTile(page, label);
  await page.getByTestId('modeler-canvas').click({ position });
}

export async function setSelectedElementName(page: Page, value: string): Promise<void> {
  const nameInput = page.locator('input[name="bpmn:name"]');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(value);
}

export async function uploadStudyflowDiagram(page: Page, filename = 'sample.studyflow'): Promise<void> {
  const diagramBuffer = blankDiagram();

  await page.getByTestId('open-file-input').setInputFiles({
    name: filename,
    mimeType: 'application/xml',
    buffer: diagramBuffer,
  });
}

export async function readDownloadText(download: Download): Promise<string> {
  return (await readDownload(download)).toString('utf8');
}

export async function readDownload(download: Download): Promise<Buffer> {
  const filePath = await download.path();
  if (!filePath) {
    throw new Error('Downloaded file path is unavailable.');
  }

  return readFileSync(filePath);
}

/** The YAML an exported SVG carries: the text of its `<studyflow>`, which the serializer escaped. */
export function extractStudyflowFromSvg(svgText: string): string {
  const match = svgText.match(/<studyflow>([\s\S]*?)<\/studyflow>/);
  if (!match) {
    throw new Error('Embedded studyflow metadata not found in SVG output.');
  }

  return match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}