import { expect, test, type Page } from '@playwright/test';

import { diagramTitle, examplePath, exportDiagram, gotoModeler, readDownload, readDownloadText } from './utils';

/**
 * Icons, end to end. The canvas reads each class's glyph out of the app's own stylesheet
 * (the Tailwind iconify plugin compiles every icon into a `--svg` data URI) and draws real
 * `<path>` geometry, so an export is a plain serialization, offline, with no icon pass.
 * How each resolver answer is drawn is `packages/canvas/tests/canvas-icons.unit.spec.ts`'s.
 */

/** Open a shipped example and wait for its title. */
async function openExample(page: Page, name: string, title: string): Promise<void> {
  await page.getByTestId('open-file-input').setInputFiles(examplePath(name));
  await expect(diagramTitle(page)).toContainText(title);
}

/** A user task whose icon is a `data:` image: red, so the raster shows whether it was painted. */
const IMAGE_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#f00"/></svg>')}`;
const IMAGE_ICON_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process" isExecutable="false">
    <bpmn:userTask id="Task" name="Ask" studyflow:icon="${IMAGE_ICON}" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="Process">
      <bpmndi:BPMNShape id="Task_di" bpmnElement="Task"><dc:Bounds x="100" y="100" width="100" height="80" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test.describe('native SVG icons', () => {
  test('the canvas and its SVG and PNG exports carry glyph paths, fetched from nowhere', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => { if (request.url().includes('iconify')) requests.push(request.url()); });
    await gotoModeler(page);
    // kitchensink holds typed tasks, markers, and container activities, which BPMN draws no type glyph for.
    await openExample(page, 'kitchensink', 'kitchen sink');

    const canvas = page.getByTestId('modeler-canvas');
    await expect(canvas.locator('svg.sf-icon path').first()).toBeAttached();
    await expect(canvas.locator('foreignObject.icon-container')).toHaveCount(0);

    const svg = await readDownloadText(await exportDiagram(page, 'svg'));
    expect(svg).toMatch(/<svg[^>]*class="sf-icon"[^>]*>\s*<path/);
    // The exported document needs no stylesheet to paint, and `currentColor` is already
    // resolved to the element's own stroke colour.
    expect(svg).not.toContain('foreignObject');
    expect(svg).not.toContain('data-icon-class');
    expect(svg).not.toContain('currentColor');

    const png = await readDownload(await exportDiagram(page, 'png'));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(requests).toEqual([]);
  });

  test('an icon that is a data: image is painted into the PNG export', async ({ page }) => {
    await gotoModeler(page);
    await page.getByTestId('open-file-input').setInputFiles({
      name: 'image_icon.studyflow', mimeType: 'application/xml', buffer: Buffer.from(IMAGE_ICON_XML),
    });
    await expect(page.getByTestId('modeler-canvas').locator('image.sf-icon[data-icon-key="UserTask"]')).toBeAttached();

    // The raster reads back (an `<image>` does not taint it, as a foreignObject does) with the glyph painted.
    const png = await readDownload(await exportDiagram(page, 'png'));
    const redPixels = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const context = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height }).getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 50 && data[i + 2] < 50) count += 1;
      return count;
    }, png.toString('base64'));
    expect(redPixels).toBeGreaterThan(0);
  });
});
