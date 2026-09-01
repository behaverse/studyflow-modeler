import { expect, test } from '@playwright/test';

import {
  categoryOf,
  compareExamples,
  galleryCategories,
  UNCATEGORIZED,
} from '@modeler/examples/catalog';
import { firstSentence } from '@core/naming';
import { exampleCategories, exampleNames, exampleXml } from './utils';

/**
 * Examples ship as one PNG each: the picture of a diagram with the diagram inside it. The folder
 * it sits in — `assets/schemas/examples/<Category>/` — is the shelf its card lands on, so the file
 * itself carries no category.
 */

function rootTag(xml: string): string {
  return xml.match(/<bpmn2?:(?:process|collaboration|choreography)\b[^>]*>/)?.[0] ?? '';
}

test.describe('shipped examples', () => {
  test('there are examples, and each one is a diagram', () => {
    expect(exampleNames.length).toBeGreaterThan(0);
    for (const filename of exampleNames) {
      expect(exampleXml(filename), `${filename} carries no studyflow`).toContain('<bpmn');
    }
  });

  test('each declares the title and blurb its card is made of', () => {
    for (const filename of exampleNames) {
      const xml = exampleXml(filename);

      expect(rootTag(xml), `${filename} has no named root`).toMatch(/ name="[^"]+"/);

      const documentation = xml.match(/<bpmn2?:documentation\b[^>]*>([\s\S]*?)<\/bpmn2?:documentation>/);
      const blurb = firstSentence(documentation?.[1] ?? '');
      expect(blurb, `${filename} documents nothing to put on its card`).not.toBe('');
      expect(blurb.length, `${filename}'s first sentence overflows its card`).toBeLessThan(160);
    }
  });

  test('the folder is the category, so no example repeats it inside the file', () => {
    for (const filename of exampleNames) {
      expect(exampleCategories.get(filename), `${filename} sits directly in the examples root`)
        .toBeTruthy();
      expect(exampleXml(filename), `${filename} still carries studyflow:tags`)
        .not.toContain('<studyflow:tags>');
    }
  });

  test('opening one reopens the diagram it pictures', () => {
    // The payload is what `open-diagram` reads out of a `.png`, so a card click and a drop are the same import.
    const xml = exampleXml('cognitive_battery.studyflow.png');
    expect(xml).toContain('id="Task_NBack"');
    expect(xml).toContain('name="Within-subject cognitive battery"');
  });
});

test.describe('gallery shelves', () => {
  test('are the folder names, alphabetical, with Other last', () => {
    expect(galleryCategories(['Demos', 'AI & ML', 'Demos']))
      .toEqual(['AI & ML', 'Demos']);
    expect(galleryCategories(['Robotics', undefined, 'AI & ML']))
      .toEqual(['AI & ML', 'Robotics', UNCATEGORIZED]);
    expect(categoryOf('  ')).toBe(UNCATEGORIZED);
    expect(categoryOf(undefined)).toBe(UNCATEGORIZED);
  });

  test('every shipped example lands on a real shelf', () => {
    for (const filename of exampleNames) {
      expect(categoryOf(exampleCategories.get(filename)), filename).not.toBe(UNCATEGORIZED);
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
