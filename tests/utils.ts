import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Download, type Locator, type Page } from '@playwright/test';

import { xmlToStudyflow } from '@core/document';
import { extractXmlFromPng } from '@core/document/png';

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

/**
 * Which editor backend the e2e run drives (P6a). The `e2e` project — the default,
 * what `npm run test:e2e` runs — is bpmn, exactly as a user gets it; the
 * `e2e-canvas` project points the *same* specs at the native canvas through the
 * `?editor=` flag, so no rebuild or dev-server restart is needed to switch.
 * `STUDYFLOW_EDITOR_BACKEND` overrides the project name for ad-hoc runs.
 *
 * Called from inside a test (never at module scope): the project name comes from
 * the running test's info.
 */
export function editorBackend(): 'bpmn' | 'canvas' {
  const fromEnv = process.env.STUDYFLOW_EDITOR_BACKEND?.trim();
  if (fromEnv === 'canvas' || fromEnv === 'bpmn') return fromEnv;
  return test.info().project.name === 'e2e-canvas' ? 'canvas' : 'bpmn';
}

/** True while the run drives the native canvas backend. */
export function onCanvasBackend(): boolean {
  return editorBackend() === 'canvas';
}

export async function gotoModeler(page: Page): Promise<void> {
  await page.goto(`/app?editor=${editorBackend()}`);
  await expect(page.getByTestId('modeler-app')).toBeAttached();
  await expect(page.getByTestId('modeler-ready')).toBeAttached({ timeout: 30_000 });
  await expect(page.getByTestId('modeler-canvas')).toBeVisible();
  await expectBackendMounted(page);
}

/**
 * Pin *which* editor actually mounted.
 *
 * Every other selector in this suite is deliberately backend-agnostic so one spec
 * set can drive both backends — which means a regression in `?editor=` handling
 * (or a dropped query param here) would silently turn `test:e2e:canvas` into a
 * second bpmn run that still passes. This is the one assertion that cannot be
 * satisfied by the wrong backend: diagram-js owns `.djs-container`, the native
 * canvas owns `svg.sf-canvas`, and neither ever renders the other's root.
 */
export async function expectBackendMounted(page: Page): Promise<void> {
  const canvas = page.getByTestId('modeler-canvas');
  const nativeRoot = canvas.locator('svg.sf-canvas');
  const diagramJsRoot = canvas.locator('.djs-container');

  if (onCanvasBackend()) {
    await expect(nativeRoot, 'expected the native canvas backend to be mounted').toBeVisible();
    await expect(diagramJsRoot, 'diagram-js must not be mounted on the canvas backend').toHaveCount(0);
  } else {
    await expect(diagramJsRoot, 'expected the bpmn-js backend to be mounted').toBeVisible();
    await expect(nativeRoot, 'the native canvas must not be mounted on the bpmn backend').toHaveCount(0);
  }
}

/**
 * The in-place label editor, whichever backend drew it: diagram-js mounts a
 * `contenteditable` div, the canvas a `<textarea>`. Both are single-instance and
 * both accept `fill()`; only *reading* the text differs, hence
 * {@link expectEditorText}.
 */
export function labelEditor(page: Page): Locator {
  return page.locator('.djs-direct-editing-content, .sf-label-editor');
}

/** Assert the open label editor's text, reading `value` or `textContent` as the node demands. */
export async function expectEditorText(page: Page, expected: string): Promise<void> {
  await expect(labelEditor(page)).toBeVisible();
  await expect
    .poll(() => labelEditor(page).evaluate((node: any) => node.value ?? node.textContent ?? ''))
    .toBe(expected);
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