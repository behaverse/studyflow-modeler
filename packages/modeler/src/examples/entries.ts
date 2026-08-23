import { compareExamples } from '@modeler/examples/catalog';
import { basename, readExampleMetadata } from '@modeler/examples/metadata';
import { filenameStem } from '@modeler/diagram/file';

/** Each example is a PNG carrying its own studyflow (see `export/pngEmbedding`), so the picture on the card is the file that opens. */
const exampleFiles = import.meta.glob(
  '#assets/examples/*.png',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

export type ExampleEntry = {
  filename: string;
  url: string;
  title: string;
  summary: string;
  tags: string[];
  error?: string;
};

/** Filenames alone, enough to draw the gallery before any PNG has been fetched. */
export function buildInitialEntries(): ExampleEntry[] {
  return Object.entries(exampleFiles)
    .map(([path, url]) => ({
      filename: basename(path),
      url,
      title: filenameStem(basename(path)),
      summary: '',
      tags: [],
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
