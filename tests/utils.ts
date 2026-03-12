import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Download, type Page } from '@playwright/test';

export async function gotoModeler(page: Page): Promise<void> {
  await page.goto('/app');
  await expect(page.getByTestId('modeler-app')).toBeAttached();
  await expect(page.getByTestId('modeler-ready')).toBeAttached({ timeout: 30_000 });
  await expect(page.getByTestId('modeler-canvas')).toBeVisible();
}

export async function openFileMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'File' }).click();
  await expect(page.getByText('Open File...', { exact: true })).toBeVisible();
}

export async function addPaletteElement(
  page: Page,
  title: string,
  position: { x: number; y: number },
): Promise<void> {
  await page.getByTitle(title).click();
  await page.getByTestId('modeler-canvas').click({ position });
}

export async function addSchemaPaletteElement(
  page: Page,
  schemaPrefix: string,
  label: string,
  position: { x: number; y: number },
): Promise<void> {
  await page.getByTitle(`More ${schemaPrefix} elements...`).click();

  const popupEntry = page
    .locator('.djs-popup .entry')
    .filter({ has: page.locator('.djs-popup-label', { hasText: label }) })
    .first();

  await expect(popupEntry).toBeVisible();
  await popupEntry.click();
  await page.getByTestId('modeler-canvas').click({ position });
}

export async function setSelectedElementName(page: Page, value: string): Promise<void> {
  const nameInput = page.locator('input[name="bpmn:name"]');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(value);
}

export async function uploadStudyflowDiagram(page: Page, filename = 'sample.studyflow'): Promise<void> {
  const diagramBuffer = readFileSync(path.join(process.cwd(), 'src/assets/new_diagram.bpmn'));

  await page.locator('input[type="file"]').setInputFiles({
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