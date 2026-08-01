import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Download, type Page } from '@playwright/test';

import { xmlToStudyflow } from '../src/core/codec';
import { extractXmlFromPng } from '../src/modeler/models/exporters/pngEmbedding';

const EXAMPLES_DIR = path.join(process.cwd(), 'src/assets/examples');

/** Raw bytes of a shipped example. Examples are PNGs of themselves: the image
 *  carries the diagram, so this is both the picture and the source. */
export function exampleFile(filename: string): Buffer {
  return readFileSync(path.join(EXAMPLES_DIR, filename));
}

/** The BPMN XML inside a shipped example. */
export function exampleXml(filename: string): string {
  return extractXmlFromPng(exampleFile(filename));
}

/** ...and the `.studyflow` YAML the modeler writes for it. */
export function exampleStudyflow(filename: string, moddle: any): Promise<string> {
  return xmlToStudyflow(exampleXml(filename), moddle);
}

/** Strip diagram interchange, for the layout passes that only run without it. */
export function withoutDiagramInterchange(xml: string): string {
  return xml.replace(/\s*<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/g, '');
}

export async function gotoModeler(page: Page): Promise<void> {
  await page.goto('/app');
  await expect(page.getByTestId('modeler-app')).toBeAttached();
  await expect(page.getByTestId('modeler-ready')).toBeAttached({ timeout: 30_000 });
  await expect(page.getByTestId('modeler-canvas')).toBeVisible();
}

/**
 * Send a modeler shortcut (undo, delete, ...) to the diagram. The modeler's
 * keyboard listens on the canvas SVG only, so a shortcut lands only while that
 * node has focus; pressing on it focuses it directly. Clicking empty canvas
 * focuses it too, but that gesture *clears the selection* - and with it any
 * selection-dependent inspector tab. Only diagram-js's 400ms post-drag
 * ghost-click trap (`Dragging#trapClickAndEnd`) ever hid that, which made the
 * click deselect or not depending on how fast the preceding steps ran.
 */
export async function pressOnCanvas(page: Page, key: string): Promise<void> {
  await page.getByTestId('modeler-canvas').locator('svg[tabindex]').press(key);
}

export async function openCommandPalette(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open command palette' }).click();
  await expect(page.getByPlaceholder(/Search commands/)).toBeVisible();
}

/**
 * Open the command palette and click through one or more entries
 * (e.g. 'Import...' then 'jsPsych Timeline...' for submenu commands).
 */
export async function runPaletteCommand(page: Page, ...labels: string[]): Promise<void> {
  await openCommandPalette(page);
  for (const label of labels) {
    await page.getByRole('dialog').getByText(label, { exact: true }).click();
  }
}

/** Serve every Iconify glyph locally so image exports don't touch the network. */
export async function stubIconify(page: Page): Promise<void> {
  await page.route('https://api.iconify.design/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>',
    });
  });
}

/** `aria-label` of each embed switch in the Export dialog, keyed by option id. */
const EMBED_SWITCH_LABELS: Record<string, string> = {
  studyflow: 'Embed Studyflow source',
  drawio: 'Embed draw.io diagram',
};

/**
 * Drive the Export dialog end to end: pick `format` (an `ExportFormatId` such
 * as `studyflow` or `png`), flip any embed toggles named in `embed` — image
 * formats only, both on by default — and return the resulting download.
 */
export async function exportDiagram(
  page: Page,
  format: string,
  embed: Partial<Record<'studyflow' | 'drawio', boolean>> = {},
): Promise<Download> {
  await runPaletteCommand(page, 'Export...');
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId('export-format').selectOption(format);

  for (const [id, on] of Object.entries(embed)) {
    const toggle = page.getByRole('switch', { name: EMBED_SWITCH_LABELS[id] });
    if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  }

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-submit').click();
  return downloadPromise;
}

/** Click a tile (by its exact label) inside the currently open palette flyout. */
async function clickPaletteTile(page: Page, label: string): Promise<void> {
  // A flyout can list a BPMN item and a same-named schema extra; the BPMN
  // group items render first, so take the first visible match.
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
  await page.getByRole('button', { name: `More ${schemaName} elements...` }).click();
  await clickPaletteTile(page, label);
  await page.getByTestId('modeler-canvas').click({ position });
}

export async function setSelectedElementName(page: Page, value: string): Promise<void> {
  const nameInput = page.locator('input[name="bpmn:name"]');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(value);
}

export async function uploadStudyflowDiagram(page: Page, filename = 'sample.studyflow'): Promise<void> {
  const diagramBuffer = readFileSync(path.join(process.cwd(), 'src/assets/examples/new_diagram.bpmn'));

  await page.getByTestId('open-file-input').setInputFiles({
    name: filename,
    mimeType: 'application/xml',
    buffer: diagramBuffer,
  });
}

export async function readDownloadText(download: Download): Promise<string> {
  return (await readDownload(download)).toString('utf8');
}

/** Raw bytes of a download, for binary formats (PNG). */
export async function readDownload(download: Download): Promise<Buffer> {
  const filePath = await download.path();
  if (!filePath) {
    throw new Error('Downloaded file path is unavailable.');
  }

  return readFileSync(filePath);
}

export function extractStudyflowFromSvg(svgText: string): string {
  const match = svgText.match(/<studyflow>([\s\S]*?)<\/studyflow>/i);
  if (!match) {
    throw new Error('Embedded studyflow metadata not found in SVG output.');
  }

  return match[1].trim();
}

export function normalizeXml(xml: string): string {
  return xml
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/\s*\/\s*>/g, '/>')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
}