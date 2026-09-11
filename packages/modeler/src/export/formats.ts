import type { Editor } from '@modeler/editor/port';
import type { ExportModel } from '@modeler/export/model';
import { SKILL_EXPORT_FORMATS, SKILL_OPENERS, type Opener } from '@modeler/skillModules';

/** The formats that carry the diagram itself, encoded by `export/commands.ts`. */
export type DiagramFormatId = 'studyflow' | 'bpmn' | 'svg' | 'png';

/** A projection names its own id. */
export type ExportFormatId = DiagramFormatId | (string & {});

export type EncodeContext = {
  modeler: Editor;
  renderSvg: () => Promise<{ svg: string; xml: string }>;
  /** The semantic view of the diagram, built on demand; only projections read it. */
  exportModel: () => ExportModel;
};

export type ExportFormatGroup = 'Diagram' | 'Image' | 'Interchange';

export type ExportFormat = {
  id: ExportFormatId;
  group: ExportFormatGroup;
  label: string;
  extension: string;
  mimeType: string;
  /** Carries the studyflow inside it, so the exported picture opens back in this modeler. */
  embeddable?: boolean;
  importable?: boolean;
  alsoReads?: string[];
  /** A projection writes itself: a document derived for another tool, one file per format. */
  encode?: (ctx: EncodeContext) => BlobPart | Promise<BlobPart>;
};


const EXPORT_FORMATS: ExportFormat[] = [
  {
    id: 'studyflow',
    group: 'Diagram',
    label: 'Studyflow',
    // `.studyflow.*`: the part before the last dot says what the file is, the part after how it is encoded.
    extension: '.studyflow.yaml',
    mimeType: 'text/yaml;charset=utf-8',
    importable: true,
    alsoReads: ['.studyflow'],
  },
  {
    id: 'bpmn',
    group: 'Diagram',
    label: 'BPMN 2.0 XML',
    extension: '.bpmn',
    mimeType: 'application/xml;charset=utf-8',
    importable: true,
    alsoReads: ['.xml'],
  },
  {
    id: 'svg',
    group: 'Image',
    label: 'SVG',
    extension: '.studyflow.svg',
    mimeType: 'image/svg+xml;charset=utf-8',
    embeddable: true,
    importable: true,
    alsoReads: ['.svg'],
  },
  {
    id: 'png',
    group: 'Image',
    label: 'PNG',
    extension: '.studyflow.png',
    mimeType: 'image/png',
    embeddable: true,
    importable: true,
    alsoReads: ['.png'],
  },
  // A projection, a document derived for another tool, comes from a skill's `modeler.ts`, which carries its descriptor and its encoder.
  ...SKILL_EXPORT_FORMATS,
];

export const IMPORTABLE_EXTENSIONS: string[] = EXPORT_FORMATS
  .filter((format) => format.importable)
  .flatMap((format) => [format.extension, ...(format.alsoReads ?? [])]);

/** The foreign formats skills open (a jsPsych timeline): converted to a studyflow on the way in, so the open picker offers them too. */
export const OPENERS: Opener[] = SKILL_OPENERS;

/** Everything "Open" accepts, which is every importable format plus the foreign ones it converts. */
export const OPENABLE_EXTENSIONS: string[] = [...IMPORTABLE_EXTENSIONS, ...OPENERS.map((opener) => opener.extension)];

/** The formats "Open" round-trips, for telling the user what this app will take. */
export const IMPORTABLE_FORMATS: ExportFormat[] = EXPORT_FORMATS.filter((format) => format.importable);

/** Every spelling of one format, longest first, as the open dialog lists them. */
export const extensionsOf = (format: ExportFormat): string[] =>
  [format.extension, ...(format.alsoReads ?? [])];

/** Every compound extension the catalog declares, longest first so the longest match wins. */
export const COMPOUND_EXTENSIONS: string[] = EXPORT_FORMATS
  .map((format) => format.extension)
  .filter((extension) => extension.split('.').length > 2)
  .sort((a, b) => b.length - a.length);

/** MIME essence: the file pickers reject a type that carries parameters such as `;charset=utf-8`. */
const mimeEssence = (format: { mimeType: string }): string => format.mimeType.split(';')[0];

/** Every extension the open picker should offer, grouped the way `FilePickerAcceptType` wants it. */
export const OPENABLE_ACCEPT: Record<string, string[]> = EXPORT_FORMATS
  .filter((format) => format.importable)
  .reduce<Record<string, string[]>>((accept, format) => {
    const mime = mimeEssence(format);
    accept[mime] = [...(accept[mime] ?? []), format.extension, ...(format.alsoReads ?? [])];
    return accept;
  }, OPENERS.reduce<Record<string, string[]>>((accept, opener) => {
    const mime = mimeEssence(opener);
    accept[mime] = [...(accept[mime] ?? []), opener.extension];
    return accept;
  }, {}));

/** The skill that opens `filename`, if a foreign format claims its extension. */
export function openerFor(filename: string): Opener | undefined {
  const lower = filename.toLowerCase();
  return OPENERS.find((opener) => lower.endsWith(opener.extension.toLowerCase()));
}

/** Whether the file carries the diagram itself, rather than being a document derived from it. */
export const carriesDiagram = (format: ExportFormat): boolean =>
  !!format.importable || !!format.embeddable;

/**
 * Whether a file in this format is cheap enough to rewrite on every edit. Producing an image means
 * rendering the whole diagram — rasterizing, resolving icons, re-encoding — which is seconds of
 * work, so an image is only ever written by a save the user asked for.
 */
export const autoSavable = (format: ExportFormat): boolean => format.group !== 'Image';

/** The save picker offers one format: the one the file is being written back as. */
export function formatAccept(format: ExportFormat): Record<string, string[]> {
  return { [mimeEssence(format)]: [format.extension] };
}

export function importableFormatFor(filename: string): ExportFormat | undefined {
  const lower = filename.toLowerCase();
  return EXPORT_FORMATS
    .filter((format) => format.importable)
    .flatMap((format) => [format.extension, ...(format.alsoReads ?? [])].map((ext) => ({ format, ext })))
    .filter(({ ext }) => lower.endsWith(ext.toLowerCase()))
    .sort((a, b) => b.ext.length - a.ext.length)[0]?.format;
}

export const EXPORT_FORMAT_GROUPS: Array<[ExportFormatGroup, ExportFormat[]]> = (
  ['Diagram', 'Image', 'Interchange'] as ExportFormatGroup[]
).map((group) => [group, EXPORT_FORMATS.filter((format) => format.group === group)]);

export function getExportFormat(id: ExportFormatId): ExportFormat {
  const format = EXPORT_FORMATS.find((candidate) => candidate.id === id);
  if (!format) throw new Error(`Unknown export format: ${id}`);
  return format;
}

export function exportFilename(name: string, format: ExportFormat): string {
  return `${name}${format.extension}`;
}
