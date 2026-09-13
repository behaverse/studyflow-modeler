import { expect, test } from '@playwright/test';

import {
  categoryOf,
  compareExamples,
  galleryCategories,
  UNCATEGORIZED,
} from '@modeler/examples/catalog';
import { firstSentence } from '@core/naming';
import { exampleMetadata } from '@modeler/examples/metadata';
import { BpmnModdle } from 'bpmn-moddle';
import { loadSchemaModels, schemaPackages } from './schemas';
import { exampleCategories, exampleNames, exampleXml } from './utils';

/**
 * An example ships as a `.studyflow.png`, the picture of a diagram with the diagram inside it, or
 * as a `.studyflow.yaml`. The skill it ships with — `skills/<name>/examples/` — is the shelf its
 * card lands on, so the file itself carries no category.
 */

const moddle = new BpmnModdle(schemaPackages(loadSchemaModels())) as any;

async function definitionsOf(name: string): Promise<any> {
  return (await moddle.fromXML(await exampleXml(name))).rootElement;
}

test.describe('shipped examples', () => {
  test('there are examples, and each one is a diagram', async () => {
    expect(exampleNames.length).toBeGreaterThan(0);
    for (const name of exampleNames) {
      expect(await exampleXml(name), `${name} carries no studyflow`).toContain('<bpmn');
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
    expect(exampleMetadata(await definitionsOf('spirit2025'), 'spirit2025')).toEqual({
      title: 'SPIRIT 2025 trial protocol',
      summary: expect.stringMatching(/^A SPIRIT 2025 trial protocol in lanes/),
    });
  });

  test('the skill is the shelf, so no example repeats it inside the file', async () => {
    for (const name of exampleNames) {
      expect(exampleCategories.get(name), `${name} sits directly in the examples root`)
        .toBeTruthy();
      expect(await exampleXml(name), `${name} still carries studyflow:tags`)
        .not.toContain('<studyflow:tags>');
    }
  });

  test('opening one reopens the diagram it pictures', async () => {
    // The same XML `OpenDiagram` reads out of the file, so a card click and a drop are the same import.
    const xml = await exampleXml('cognitive_battery');
    expect(xml).toContain('id="Task_NBack"');
    expect(xml).toContain('name="Within-subject cognitive battery"');
  });
});

test.describe('gallery shelves', () => {
  test('are the skill names, alphabetical, with Other last', () => {
    expect(galleryCategories(['Demos', 'AI & ML', 'Demos']))
      .toEqual(['AI & ML', 'Demos']);
    expect(galleryCategories(['Robotics', undefined, 'AI & ML']))
      .toEqual(['AI & ML', 'Robotics', UNCATEGORIZED]);
    expect(categoryOf('  ')).toBe(UNCATEGORIZED);
    expect(categoryOf(undefined)).toBe(UNCATEGORIZED);
  });

  test('every shipped example lands on a real shelf', () => {
    for (const name of exampleNames) {
      expect(categoryOf(exampleCategories.get(name)), name).not.toBe(UNCATEGORIZED);
    }
  });

  test('order cards by shelf, then by title', () => {
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

test.describe('card blurbs', () => {
  test('take the first sentence of the diagram\'s own documentation', () => {
    expect(firstSentence('A short study. It also does more.')).toBe('A short study.');
    expect(firstSentence('One line\nwrapped across two.')).toBe('One line wrapped across two.');
    expect(firstSentence('Reads a pandas.DataFrame and fits it. Then scores.'))
      .toBe('Reads a pandas.DataFrame and fits it.');
    expect(firstSentence('Runs a battery, e.g. an N-back block. Then a survey.'))
      .toBe('Runs a battery, e.g. an N-back block.');
    expect(firstSentence('An unfinished note')).toBe('An unfinished note');
    expect(firstSentence('')).toBe('');
  });
});
