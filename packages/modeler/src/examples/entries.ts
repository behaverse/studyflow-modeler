import { studyflowToDefinitions } from '@core/document';
import { extractStudyflowFromPng } from '@core/document/png';
import type { Moddle } from '@core/element/moddle';
import { SCHEMA_MODELS, skillOfSchema } from '@core/notation/loader';
import { compareExamples } from '@modeler/examples/catalog';
import { exampleMetadata } from '@modeler/examples/metadata';
import { drawPreview } from '@modeler/examples/preview';
import { filenameStem } from '@modeler/diagram/file';

/**
 * An example ships with a skill, in its `examples/` folder, and that skill is its gallery shelf. A
 * `.studyflow.png` carries its own studyflow (`@core/document/png`), so its picture is the file
 * that opens; a `.studyflow.yaml` is drawn when the gallery first opens.
 */
const exampleFiles = import.meta.glob(
  ['@skills/*/examples/*.studyflow.png', '@skills/*/examples/*.studyflow.yaml'],
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

export type ExampleEntry = {
  filename: string;
  url: string;
  /** The card's picture: the PNG itself, or a YAML example once drawn. */
  thumb?: string;
  title: string;
  summary: string;
  /** Gallery shelf: the skill whose `examples/` folder holds the file. */
  category: string;
  /** The icon of the schema that skill ships, if it ships one. */
  badge?: string;
  error?: string;
};

const isPng = (entry: ExampleEntry) => entry.filename.endsWith('.png');

/** The gallery remounts on every open; what it read stays for the page. */
let read: Promise<ExampleEntry[]> | undefined;
let cards: ExampleEntry[] | undefined;

/** The cards as last read, else the filenames alone: enough to draw the gallery before any file has been read. */
export function buildInitialEntries(): ExampleEntry[] {
  return cards ?? Object.entries(exampleFiles)
    .map(([path, url]): ExampleEntry => {
      const filename = path.split('/').pop() ?? path;
      const category = path.split('/').at(-3) ?? '';
      const badge = SCHEMA_MODELS.find((model) => skillOfSchema(model.prefix)?.name === category)?.icon;
      const entry: ExampleEntry = { filename, url, title: filenameStem(filename), summary: '', category, badge };
      return isPng(entry) ? { ...entry, thumb: url } : entry;
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

/**
 * The same entries with each example's title and blurb read in, and each YAML example drawn. A
 * failed read keeps the card and marks it; an example this page's schemas cannot build is left out.
 */
export function loadExampleEntries(moddle: Moddle): Promise<ExampleEntry[]> {
  read ??= Promise.all(
    buildInitialEntries().map(async (entry) => {
      try {
        const bytes = await fetch(entry.url).then((r) => r.arrayBuffer());
        const yaml = isPng(entry) ? extractStudyflowFromPng(bytes) : new TextDecoder().decode(bytes);
        return card(entry, yaml, moddle);
      } catch (err) {
        console.error(`Failed to read example ${entry.filename}:`, err);
        return { ...entry, error: 'Could not be read. Reload the page to try again.' };
      }
    }),
  ).then((entries) => (cards = entries.filter((entry) => entry !== undefined).sort(compareExamples)));
  return read;
}

/** An example's card, a YAML one drawn; nothing when it names a type no enabled schema declares. */
function card(entry: ExampleEntry, yaml: string, moddle: Moddle): ExampleEntry | undefined {
  let definitions;
  try {
    definitions = studyflowToDefinitions(yaml, moddle);
  } catch (err) {
    console.warn(`Example ${entry.filename} is left out of the gallery:`, err);
    return undefined;
  }
  const metadata = exampleMetadata(definitions, entry.title);
  if (isPng(entry)) return { ...entry, ...metadata };
  const svg = drawPreview(definitions);
  return { ...entry, ...metadata, thumb: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })) };
}
