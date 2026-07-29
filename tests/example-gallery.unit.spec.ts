import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  categoriesOf,
  compareExamples,
  galleryCategories,
  isInCategory,
  UNCATEGORIZED,
} from '../src/modeler/models/dialogs/exampleCatalog';
import { firstSentence } from '../src/modeler/models/dialogs/exampleMetadata';
import { extractXmlFromPng } from '../src/modeler/models/exporters/pngEmbedding';

/**
 * Examples ship as one PNG each — the picture of a diagram with the diagram
 * inside it. Everything the gallery shows (title, one-sentence blurb, and the
 * shelf it sits on) is an attribute of that diagram, so these check the files
 * themselves: a card cannot be right if what it reads isn't there.
 */

const EXAMPLES_DIR = path.join(process.cwd(), 'src/assets/examples');
const examples = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.png')).sort();

/** The embedded diagram of a shipped example. */
function diagramOf(filename: string): string {
  return extractXmlFromPng(readFileSync(path.join(EXAMPLES_DIR, filename)));
}

/** The shelves a shipped diagram declares, under either spelling: the current
 *  `<studyflow:categories>` children or the legacy `studyflow:category`
 *  attribute (see `Classification#categories.meta.legacyNames`). */
function shelvesOf(xml: string): string[] {
  const declared = [...xml.matchAll(/<studyflow:categories>([\s\S]*?)<\/studyflow:categories>/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  if (declared.length > 0) return declared;
  const legacy = xml.match(/studyflow:category="([^"]+)"/)?.[1];
  return legacy ? [legacy] : [];
}

/** First root element of the definitions, as raw markup. */
function rootTag(xml: string): string {
  return xml.match(/<bpmn2?:(?:process|collaboration|choreography)\b[^>]*>/)?.[0] ?? '';
}

test.describe('shipped examples', () => {
  test('there are examples, and each one is a diagram', () => {
    expect(examples.length).toBeGreaterThan(0);
    for (const filename of examples) {
      expect(diagramOf(filename), `${filename} carries no studyflow`).toContain('<bpmn');
    }
  });

  test('each declares the title, blurb, and shelf its card is made of', () => {
    for (const filename of examples) {
      const xml = diagramOf(filename);

      expect(rootTag(xml), `${filename} has no named root`).toMatch(/ name="[^"]+"/);
      expect(shelvesOf(xml), `${filename} declares no category — its card would fall to "${UNCATEGORIZED}"`)
        .not.toHaveLength(0);

      const documentation = xml.match(/<bpmn2?:documentation\b[^>]*>([\s\S]*?)<\/bpmn2?:documentation>/);
      const blurb = firstSentence(documentation?.[1] ?? '');
      expect(blurb, `${filename} documents nothing to put on its card`).not.toBe('');
      expect(blurb.length, `${filename}'s first sentence overflows its card`).toBeLessThan(160);
    }
  });

  test('opening one reopens the diagram it pictures', () => {
    // The payload is what `open-diagram` reads back out of a `.png`, so a card
    // click and a drag-and-drop of the same file are the same import.
    const xml = diagramOf('cognitive_battery.png');
    expect(xml).toContain('id="Task_NBack"');
    expect(xml).toContain('name="Within-subject cognitive battery"');
  });
});

test.describe('gallery shelves', () => {
  test('are whatever the diagrams declare, alphabetical, with Other last', () => {
    expect(galleryCategories([['Study designs'], ['AI agents'], ['Study designs']]))
      .toEqual(['AI agents', 'Study designs']);
    // A diagram with no category still gets a shelf, and it sorts last.
    expect(galleryCategories([['Reference'], undefined, ['AI agents']]))
      .toEqual(['AI agents', 'Reference', UNCATEGORIZED]);
    expect(categoriesOf(['  '])).toEqual([UNCATEGORIZED]);
    expect(categoriesOf([])).toEqual([UNCATEGORIZED]);
  });

  test('a diagram on several shelves appears under each', () => {
    // The same list form a schema property uses for its `meta.categories`.
    const card = ['AI agents', 'Reference'];
    expect(galleryCategories([card])).toEqual(['AI agents', 'Reference']);
    expect(isInCategory(card, 'AI agents')).toBe(true);
    expect(isInCategory(card, 'Reference')).toBe(true);
    expect(isInCategory(card, 'Study designs')).toBe(false);
  });

  test('order cards by shelf, then by title', () => {
    const cards = [
      { categories: [], title: 'Zebra' },
      { categories: ['Study designs'], title: 'CONSORT 2025' },
      { categories: ['AI agents'], title: 'Random bot' },
      { categories: ['AI agents'], title: 'Agent evaluation harness' },
    ];
    expect([...cards].sort(compareExamples).map((c) => c.title))
      .toEqual(['Agent evaluation harness', 'Random bot', 'CONSORT 2025', 'Zebra']);
  });

  test('every shipped example lands on a real shelf', () => {
    for (const filename of examples) {
      expect(categoriesOf(shelvesOf(diagramOf(filename))), filename).not.toContain(UNCATEGORIZED);
    }
  });
});

test.describe('card blurbs', () => {
  test('take the first sentence of the diagram\'s own documentation', () => {
    expect(firstSentence('A short study. It also does more.')).toBe('A short study.');
    expect(firstSentence('One line\nwrapped across two.')).toBe('One line wrapped across two.');
    // Dotted type names and abbreviations are not sentence ends.
    expect(firstSentence('Reads a pandas.DataFrame and fits it. Then scores.'))
      .toBe('Reads a pandas.DataFrame and fits it.');
    expect(firstSentence('Runs a battery, e.g. an N-back block. Then a survey.'))
      .toBe('Runs a battery, e.g. an N-back block.');
    // Nothing to cut: no terminator, or nothing documented at all.
    expect(firstSentence('An unfinished note')).toBe('An unfinished note');
    expect(firstSentence('')).toBe('');
  });
});
