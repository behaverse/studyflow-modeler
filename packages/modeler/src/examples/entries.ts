import { compareExamples } from '@modeler/examples/catalog';
import { basename, readExampleMetadata } from '@modeler/examples/metadata';
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

/** Filenames alone, enough to draw the gallery before any PNG has been fetched. */
export function buildInitialEntries(): ExampleEntry[] {
  return Object.entries(exampleFiles)
    .map(([path, url]): ExampleEntry => ({
      filename: basename(path),
      url,
      title: filenameStem(basename(path)),
      summary: '',
      category: path.split('/').at(-3) ?? '',
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

/** The same entries with each PNG's embedded metadata read in; a failed read keeps the card and marks it. */
export async function loadExampleEntries(): Promise<ExampleEntry[]> {
  const read = await Promise.all(
    buildInitialEntries().map(async (entry) => {
      try {
        const png = await fetch(entry.url).then((r) => r.arrayBuffer());
        return { ...entry, ...readExampleMetadata(entry.filename, png) };
      } catch (err) {
        console.error(`Failed to read example ${entry.filename}:`, err);
        return { ...entry, error: 'Could not be read. Reload the page to try again.' };
      }
    }),
  );
  return read.sort(compareExamples);
}
