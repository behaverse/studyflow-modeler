import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Download, type Page } from '@playwright/test';

export async function gotoModeler(page: Page): Promise<void> {
  await page.goto('/app');
  await expect(page.getByTestId('modeler-app')).toBeAttached();
  await expect(page.getByTestId('modeler-ready')).toBeAttached({ timeout: 30_000 });
  await expect(page.getByTestId('modeler-canvas')).toBeVisible();
}

export async function openCommandPalette(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open command palette' }).click();
  await expect(page.getByPlaceholder(/Search commands/)).toBeVisible();
}

/**
 * Open the command palette and click through one or more entries
 * (e.g. 'Export...' then 'SVG...' for submenu commands).
 */
export async function runPaletteCommand(page: Page, ...labels: string[]): Promise<void> {
  await openCommandPalette(page);
  for (const label of labels) {
    await page.getByRole('dialog').getByText(label, { exact: true }).click();
  }
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
  const filePath = await download.path();
  if (!filePath) {
    throw new Error('Downloaded file path is unavailable.');
  }

  return readFileSync(filePath, 'utf8');
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