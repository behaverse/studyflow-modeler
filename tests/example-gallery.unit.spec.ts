import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  tagsOf,
  compareExamples,
  galleryTags,
  hasTag,
  UNTAGGED,
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

/** The tags a shipped diagram declares. Only the current spelling: what ships
 *  is what the modeler writes today, and the older ones are the import
 *  boundary's business. */
function tagsInFile(xml: string): string[] {
  return [...xml.matchAll(/<studyflow:tags>([\s\S]*?)<\/studyflow:tags>/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
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
      expect(tagsInFile(xml), `${filename} declares no tag — its card would fall to "${UNTAGGED}"`)
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
    const xml = diagramOf('cognitive_battery.studyflow.png');
    expect(xml).toContain('id="Task_NBack"');
    expect(xml).toContain('name="Within-subject cognitive battery"');
  });
});

test.describe('gallery shelves', () => {
  test('are whatever the diagrams declare, alphabetical, with Other last', () => {
    expect(galleryTags([['Study designs'], ['AI agents'], ['Study designs']]))
      .toEqual(['AI agents', 'Study designs']);
    // A diagram with no tag still gets a shelf, and it sorts last.
    expect(galleryTags([['Reference'], undefined, ['AI agents']]))
      .toEqual(['AI agents', 'Reference', UNTAGGED]);
    expect(tagsOf(['  '])).toEqual([UNTAGGED]);
    expect(tagsOf([])).toEqual([UNTAGGED]);
  });

  test('a diagram on several shelves appears under each', () => {
    // Free-text labels, so a diagram may sit on more than one shelf.
    const card = ['AI agents', 'Reference'];
    expect(galleryTags([card])).toEqual(['AI agents', 'Reference']);
    expect(hasTag(card, 'AI agents')).toBe(true);
    expect(hasTag(card, 'Reference')).toBe(true);
    expect(hasTag(card, 'Study designs')).toBe(false);
  });

  test('order cards by shelf, then by title', () => {
    const cards = [
      { tags: [], title: 'Zebra' },
      { tags: ['Study designs'], title: 'CONSORT 2025' },
      { tags: ['AI agents'], title: 'Random bot' },
      { tags: ['AI agents'], title: 'Agent evaluation harness' },
    ];
    expect([...cards].sort(compareExamples).map((c) => c.title))
      .toEqual(['Agent evaluation harness', 'Random bot', 'CONSORT 2025', 'Zebra']);
  });

  test('every shipped example lands on a real shelf', () => {
    for (const filename of examples) {
      expect(tagsOf(tagsInFile(diagramOf(filename))), filename).not.toContain(UNTAGGED);
    }
  });

  test('each declares its tags on one root, the one its plane draws', () => {
    // A collaboration and the process it wraps are both roots. The modeler
    // reads and writes whichever one the canvas shows, so a second declaration
    // on the other root is not a harmless copy: it is a second answer, and
    // editing the shelf in the app updates only one of them.
    for (const filename of examples) {
      const xml = diagramOf(filename);
      const drawn = xml.match(/<bpmndi:BPMNPlane[^>]*bpmnElement="([^"]+)"/)?.[1];
      expect(drawn, `${filename} draws no plane`).toBeTruthy();

      const roots = [...xml.matchAll(/<bpmn2?:(process|collaboration|choreography)\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/bpmn2?:\1>/g)];
      const declaring = roots
        .filter(([, , , body]) => /<studyflow:tags>/.test(body))
        .map(([, , id]) => id);

      expect(declaring, `${filename} declares its tags on ${declaring.length} roots`).toHaveLength(1);
      expect(declaring[0], `${filename} declares its tags on a root it does not draw`).toBe(drawn);
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
