import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Download, type Page } from '@playwright/test';

import { xmlToStudyflow } from '@behaverse/studyflow-core/document';
import { extractXmlFromPng } from '../src/modeler/export/pngEmbedding';

const EXAMPLES_DIR = path.join(process.cwd(), 'assets/examples');

export function exampleFile(filename: string): Buffer {
  return readFileSync(path.join(EXAMPLES_DIR, filename));
}

export function exampleXml(filename: string): string {
  return extractXmlFromPng(exampleFile(filename));
}

export function exampleStudyflow(filename: string, moddle: any): Promise<string> {
  return xmlToStudyflow(exampleXml(filename), moddle);
}

export function withoutDiagramInterchange(xml: string): string {
  return xml.replace(/\s*<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/g, '');
}

export async function gotoModeler(page: Page): Promise<void> {
  await page.goto('/app');
  await expect(page.getByTestId('modeler-app')).toBeAttached();
  await expect(page.getByTestId('modeler-ready')).toBeAttached({ timeout: 30_000 });
  await expect(page.getByTestId('modeler-canvas')).toBeVisible();
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

export async function stubIconify(page: Page): Promise<void> {
  await page.route('https://api.iconify.design/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>',
    });
  });
}

const EMBED_SWITCH_LABELS: Record<string, string> = {
  studyflow: 'Embed Studyflow source',
  drawio: 'Embed draw.io diagram',
};

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
  const diagramBuffer = readFileSync(path.join(process.cwd(), 'assets/examples/new_diagram.bpmn'));

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