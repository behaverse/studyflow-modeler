import { expect, test, type Page } from '@playwright/test';

import { browseForDiagram, exampleFile, gotoModeler, runPaletteCommand } from './utils';

const DIAGRAM = exampleFile('new_diagram.bpmn').toString('utf8');
const DIAGRAM_B64 = Buffer.from(DIAGRAM, 'utf8').toString('base64');
/** A real PNG with the diagram embedded in it, as the modeler's own export produces. */
const DIAGRAM_PNG_B64 = exampleFile('choreography_demo.studyflow.png').toString('base64');

/** `content` is base64 so the same fake disk can hold a text diagram or a real PNG. */
type FakeDisk = { name: string; content: string; lastModified: number; writes: number };

declare global {
  interface Window {
    __disk?: FakeDisk;
  }
}

/**
 * One file, in the page, behind a handle that behaves like the real thing. Playwright cannot drive
 * the native pickers, so the pickers are what gets replaced — everything below them is the app.
 */
async function installFakeDisk(page: Page, name: string, content: string): Promise<void> {
  await page.addInitScript(({ name, content }) => {
    const disk: FakeDisk = { name, content, lastModified: 1000, writes: 0 };
    window.__disk = disk;

    const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    const makeHandle = (): any => ({
      kind: 'file',
      get name() { return disk.name; },
      async getFile() {
        return new File([bytes(disk.content)], disk.name, { lastModified: disk.lastModified });
      },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
      async isSameEntry() { return false; },
      async createWritable() {
        const parts: BlobPart[] = [];
        return {
          async write(part: BlobPart) { parts.push(part); },
          async close() {
            const buffer = new Uint8Array(await new Blob(parts).arrayBuffer());
            disk.content = btoa(String.fromCharCode(...buffer));
            // Every commit moves the timestamp, exactly as a real write does.
            disk.lastModified += 1000;
            disk.writes += 1;
          },
          async abort() { /* nothing to roll back */ },
        };
      },
    });

    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [makeHandle()],
    });
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async (options?: { suggestedName?: string }) => {
        disk.name = options?.suggestedName ?? disk.name;
        disk.content = '';
        return makeHandle();
      },
    });
  }, { name, content });
}

/** The disk as the test reads it: bytes decoded back to text, plus the raw base64 for byte checks. */
const disk = async (page: Page) => {
  const raw = await page.evaluate(() => ({ ...window.__disk! }));
  return { ...raw, text: Buffer.from(raw.content, 'base64').toString('utf8') };
};


const stamps = (xml: string): number => (xml.match(/<prov:activity/gi) ?? []).length;

async function renameDiagram(page: Page, name: string): Promise<void> {
  await page.getByTitle('Click to edit diagram name').click();
  await page.getByTestId('diagram-name-input').fill(name);
  await page.getByTestId('diagram-name-input').press('Enter');
}

test.describe('Saving back into the opened file', () => {
  test('opens through the picker, then writes every edit back with no download', async ({ page }) => {
    await installFakeDisk(page, 'demo.bpmn', DIAGRAM_B64);
    await gotoModeler(page, { pickers: true });

    await browseForDiagram(page);
    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('demo');

    const status = page.getByTestId('file-status');
    await expect(status).toContainText('demo.bpmn');
    await expect(status).toHaveAttribute('data-file-state', 'clean');
    // Opening alone writes nothing: the file is only touched once the diagram changes. Waited out
    // past the auto-save debounce, because "not yet" and "never" look identical at zero.
    await page.waitForTimeout(1500);
    expect((await disk(page)).writes).toBe(0);

    await renameDiagram(page, 'renamed');

    await expect.poll(async () => (await disk(page)).writes).toBeGreaterThan(0);
    await expect(status).toHaveAttribute('data-file-state', 'clean');
    expect((await disk(page)).text).toContain('renamed');
  });

  test('the save shortcut writes the linked file immediately', async ({ page }) => {
    await installFakeDisk(page, 'demo.bpmn', DIAGRAM_B64);
    await gotoModeler(page, { pickers: true });
    await browseForDiagram(page);
    await expect(page.getByTestId('file-status')).toContainText('demo.bpmn');

    // No edit first: an explicit save writes whether or not anything changed.
    await page.keyboard.press('ControlOrMeta+s');

    await expect.poll(async () => (await disk(page)).writes).toBe(1);
    expect((await disk(page)).text).toContain('<?xml');
  });

  test('Export saves to a file the user places, and keeps saving there', async ({ page }) => {
    await installFakeDisk(page, 'unused.bpmn', '');
    await gotoModeler(page, { pickers: true });

    await runPaletteCommand(page, 'Save...');
    await page.getByTestId('export-format').selectOption('studyflow');
    await page.getByTestId('save-submit').click();

    const status = page.getByTestId('file-status');
    await expect(status).toContainText('diagram.studyflow.yaml');
    await expect.poll(async () => (await disk(page)).writes).toBe(1);
    expect((await disk(page)).text).toContain('definitions:');

    // Linked by that save: the next edit goes to the same file without asking again.
    await renameDiagram(page, 'placed');
    await expect.poll(async () => (await disk(page)).writes).toBe(2);
    expect((await disk(page)).text).toContain('placed');
  });

  test('a file changed underneath stops auto-save until the user says overwrite', async ({ page }) => {
    await installFakeDisk(page, 'demo.bpmn', DIAGRAM_B64);
    await gotoModeler(page, { pickers: true });
    await browseForDiagram(page);
    await renameDiagram(page, 'first');
    await expect.poll(async () => (await disk(page)).writes).toBe(1);

    // Something else writes the file: a git checkout, another editor, a sync client.
    await page.evaluate(() => {
      window.__disk!.content = btoa('clobbered by something else');
      window.__disk!.lastModified += 5000;
    });

    await renameDiagram(page, 'second');
    const status = page.getByTestId('file-status');
    await expect(status).toHaveAttribute('data-file-state', 'conflict');
    expect((await disk(page)).writes).toBe(1);

    // The chip is the way out: an explicit save replaces what is on disk.
    await status.click();
    await expect.poll(async () => (await disk(page)).writes).toBe(2);
    expect((await disk(page)).text).toContain('second');
  });

  test('auto-save leaves the provenance trail alone; an explicit save signs it', async ({ page }) => {
    await installFakeDisk(page, 'demo.bpmn', DIAGRAM_B64);
    await gotoModeler(page, { pickers: true });
    await browseForDiagram(page);

    await renameDiagram(page, 'edited-once');
    await expect.poll(async () => (await disk(page)).writes).toBe(1);
    // A stamp per edit burst would turn the trail into a keystroke log, so auto-save adds none.
    expect(stamps((await disk(page)).text)).toBe(0);

    await page.keyboard.press('ControlOrMeta+s');
    await expect.poll(async () => (await disk(page)).writes).toBe(2);
    // Saving deliberately is a person saying they changed this, and that is what gets recorded.
    expect(stamps((await disk(page)).text)).toBe(1);
  });

  test('starting a new diagram lets go of the file, rather than overwriting it', async ({ page }) => {
    await installFakeDisk(page, 'demo.bpmn', DIAGRAM_B64);
    await gotoModeler(page, { pickers: true });
    await browseForDiagram(page);
    await expect(page.getByTestId('file-status')).toContainText('demo.bpmn');

    await runPaletteCommand(page, 'New...');
    await page.getByTestId('new-diagram-blank').click();
    await expect(page.getByTestId('file-status')).toHaveCount(0);

    // The blank canvas is not that file, and must never be written over it.
    await page.waitForTimeout(1500);
    const after = await disk(page);
    expect(after.writes).toBe(0);
    expect(after.text).toBe(DIAGRAM);
  });

  test('an image link waits for an explicit save rather than re-rendering per edit', async ({ page }) => {
    await installFakeDisk(page, 'demo.studyflow.png', DIAGRAM_PNG_B64);
    await gotoModeler(page, { pickers: true });
    await browseForDiagram(page);
    await expect(page.getByTestId('file-status')).toContainText('demo.studyflow.png');

    await renameDiagram(page, 'edited');

    // Writing a PNG means rasterizing the whole diagram; auto-save must not do that per edit burst.
    await page.waitForTimeout(1500);
    expect((await disk(page)).writes).toBe(0);
    await expect(page.getByTestId('file-status')).toHaveAttribute('data-file-state', 'dirty');

    await page.keyboard.press('ControlOrMeta+s');
    await expect.poll(async () => (await disk(page)).writes).toBe(1);
  });

  test('without a picker the modeler falls back to the file input and downloads', async ({ page }) => {
    await gotoModeler(page);

    await runPaletteCommand(page, 'Save...');
    // Same destination, different mechanism: the button offers a download, not a place to put it.
    await expect(page.getByTestId('save-submit')).toContainText('Download');
    await page.keyboard.press('Escape');

    const chooser = page.waitForEvent('filechooser');
    await browseForDiagram(page);
    await (await chooser).setFiles({
      name: 'fallback.bpmn',
      mimeType: 'application/xml',
      buffer: Buffer.from(DIAGRAM, 'utf8'),
    });

    await expect(page.getByTitle('Click to edit diagram name')).toHaveText('fallback');
    // An `<input type=file>` yields bytes, never a handle, so there is nothing to save back into.
    await expect(page.getByTestId('file-status')).toHaveCount(0);
  });
});
