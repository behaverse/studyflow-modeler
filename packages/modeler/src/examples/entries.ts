import { extractXmlFromPng } from '@core/document/png';
import type { Moddle } from '@core/element/moddle';
import { compareExamples } from '@modeler/examples/catalog';
import { exampleMetadata } from '@modeler/examples/metadata';
import { filenameStem } from '@modeler/diagram/file';

/**
 * Each example is a PNG carrying its own studyflow (`@core/document/png`), so the picture on
 * the card is the file that opens. It ships with a skill, in its `examples/` folder, and that
 * skill is its gallery shelf.
 */
const exampleFiles = import.meta.glob(
  '@skills/*/examples/*.png',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

export type ExampleEntry = {
  filename: string;
  url: string;
  title: string;
  summary: string;
  /** Gallery shelf: the skill whose `examples/` folder holds the PNG. */
  category: string;
  error?: string;
};

/** The gallery remounts on every open; what it read stays for the page. */
let read: Promise<ExampleEntry[]> | undefined;
let cards: ExampleEntry[] | undefined;

/** The cards as last read, else the filenames alone: enough to draw the gallery before any file has been read. */
export function buildInitialEntries(): ExampleEntry[] {
  return cards ?? Object.entries(exampleFiles)
    .map(([path, url]): ExampleEntry => {
      const filename = path.split('/').pop() ?? path;
      return { filename, url, title: filenameStem(filename), summary: '', category: path.split('/').at(-3) ?? '' };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

/** The same entries with each example's title and blurb read in; a failed read keeps the card and marks it. */
export function loadExampleEntries(moddle: Moddle): Promise<ExampleEntry[]> {
  read ??= Promise.all(
    buildInitialEntries().map(async (entry) => {
      try {
        const png = await fetch(entry.url).then((r) => r.arrayBuffer());
        const { rootElement } = await moddle.fromXML(extractXmlFromPng(png));
        return { ...entry, ...exampleMetadata(rootElement, entry.title) };
      } catch (err) {
        console.error(`Failed to read example ${entry.filename}:`, err);
        return { ...entry, error: 'Could not be read. Reload the page to try again.' };
      }
    }),
  ).then((entries) => (cards = entries.sort(compareExamples)));
  return read;
}
