import { expect, test } from '@playwright/test';

import { compareExamples, galleryCategories, UNCATEGORIZED } from '@modeler/examples/catalog';
import { studyflowToDefinitions } from '@core/document';
import { exampleMetadata } from '@modeler/examples/metadata';
import { drawPreview } from '@modeler/examples/preview';
import { installDocument } from '../packages/canvas/tests/canvasHarness';
import { freshModdle } from './schemas';
import { exampleNames, exampleStudyflow, exampleXml } from './utils';

/**
 * An example ships as a `.studyflow.yaml`. The skill it ships with — `skills/<name>/examples/` — is the shelf its
 * card lands on, so the file itself carries no category.
 */

const moddle = freshModdle();

async function definitionsOf(name: string): Promise<any> {
  return (await moddle.fromXML(await exampleXml(name))).rootElement;
}

test.describe('shipped examples', () => {
  test('there are examples, and each one is a drawn diagram', async () => {
    expect(exampleNames.length).toBeGreaterThan(0);
    for (const name of exampleNames) {
      const xml = await exampleXml(name);
      expect(xml, `${name} carries no studyflow`).toContain('<bpmn');
      // The canvas never lays out: a YAML example without shapes would draw a blank card.
      expect(xml, `${name} has no diagram interchange`).toContain('BPMNShape');
    }
  });

  test('each declares the title and blurb its card is made of', async () => {
    for (const name of exampleNames) {
      const definitions = await definitionsOf(name);
      const { title, summary } = exampleMetadata(definitions, name);

      expect(definitions.rootElements.some((root: any) => root.name?.trim() === title), `${name} has no named root`)
        .toBe(true);
      expect(summary, `${name} documents nothing to put on its card`).not.toBe('');
      expect(summary.length, `${name}'s first sentence overflows its card`).toBeLessThan(160);
    }
  });

  test('a pool diagram is read from both its roots', async () => {
    // spirit2025 names its collaboration and documents its process.
    const definitions = await definitionsOf('spirit2025');
    const rootOf = (type: string) => definitions.rootElements.find((root: any) => root.$type === type);
    const { title, summary } = exampleMetadata(definitions, 'spirit2025');
    expect(title).toBe(rootOf('bpmn:Collaboration').name);
    const documentation = (rootOf('bpmn:Process').documentation?.[0]?.text ?? '').replace(/\s+/g, ' ').trim();
    expect(summary).not.toBe('');
    expect(documentation.startsWith(summary), 'the blurb is the process documentation\'s first sentence').toBe(true);
  });

  test('a YAML example\'s card draws the main canvas, without glyphs', async () => {
    installDocument();
    const svg = drawPreview(studyflowToDefinitions(await exampleStudyflow('sklearn_pipeline', moddle), moddle));

    expect(svg).toContain('data-element-id="select_model"');
    expect(svg).not.toContain('data-element-id="cross_validate"');
    expect(svg).not.toMatch(/sf-icon|data-icon-key|foreignObject/);
  });
});

test.describe('gallery shelves', () => {
  test('are the skill names, alphabetical, with Other last, and hold their cards in title order', () => {
    expect(galleryCategories(['Demos', 'AI & ML', 'Demos']))
      .toEqual(['AI & ML', 'Demos']);
    // No shelf, or a blank one, is Other.
    expect(galleryCategories(['Robotics', undefined, '  ', 'AI & ML']))
      .toEqual(['AI & ML', 'Robotics', UNCATEGORIZED]);

    const cards = [
      { category: '', title: 'Zebra' },
      { category: 'Experimental Design', title: 'CONSORT 2025' },
      { category: 'AI & ML', title: 'Random bot' },
      { category: 'AI & ML', title: 'Agent evaluation harness' },
    ];
    expect([...cards].sort(compareExamples).map((c) => c.title))
      .toEqual(['Agent evaluation harness', 'Random bot', 'CONSORT 2025', 'Zebra']);
  });
});
