import * as yaml from 'js-yaml';
import { firstSentence } from '@core/naming';
import { SCHEMA_MODELS } from '@core/notation/loader';
import { compareExamples } from '@modeler/examples/catalog';
import { basename, readExampleMetadata } from '@modeler/examples/metadata';
import { filenameStem } from '@modeler/diagram/file';
import { getSettings } from '@modeler/settings/store';

/** Each example is a PNG carrying its own studyflow (see `export/pngEmbedding`), so the picture on the card is the file that opens. */
const exampleFiles = import.meta.glob(
  '#assets/examples/*.png',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

export type ExampleEntry = {
  filename: string;
  /** PNG examples only; schema examples carry `content` instead and draw an icon thumb. */
  url?: string;
  content?: string;
  iconClass?: string;
  title: string;
  summary: string;
  tags: string[];
  error?: string;
};

/** The `examples:` each enabled schema ships, as gallery cards opening studyflow YAML directly. */
function schemaExampleEntries(): ExampleEntry[] {
  const enabled = new Set(getSettings().enabledSchemas);
  return SCHEMA_MODELS
    .filter((model) => model.core || enabled.has(model.prefix))
    .flatMap((model) => (model.examples ?? []).map((example, index) => {
      const title = example.title ?? `${model.name} example ${index + 1}`;
      return {
        filename: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.studyflow.yaml`,
        content: typeof example.studyflow === 'string' ? example.studyflow : yaml.dump(example.studyflow),
        iconClass: example.icon ?? model.icon,
        title,
        summary: firstSentence(example.description ?? ''),
        tags: example.tags?.length ? example.tags : [model.name],
      };
    }));
}

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
    .sort((a, b) => a.filename.localeCompare(b.filename))
    .concat(schemaExampleEntries());
}

/** The same entries with each PNG's embedded metadata read in; a failed read keeps the card and marks it. */
export async function loadExampleEntries(): Promise<ExampleEntry[]> {
  const read = await Promise.all(
    buildInitialEntries().map(async (entry) => {
      if (!entry.url) return entry; // schema examples arrive with their metadata already set
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
