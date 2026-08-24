export type ExportFormatId =
  | 'studyflow'
  | 'bpmn'
  | 'svg'
  | 'png'
  | 'drawio'
  | 'linkml'
  | 'nidm'
  | 'artemis';

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
  {
    id: 'drawio',
    group: 'Interchange',
    label: 'draw.io',
    extension: '.drawio',
    mimeType: 'application/xml;charset=utf-8',
  },
  {
    id: 'linkml',
    group: 'Interchange',
    label: 'LinkML schema',
    extension: '.linkml.yaml',
    mimeType: 'text/yaml;charset=utf-8',
  },
  {
    id: 'nidm',
    group: 'Interchange',
    label: 'NIDM-Results',
    extension: '.nidm.ttl',
    mimeType: 'text/turtle;charset=utf-8',
  },
  {
    id: 'artemis',
    group: 'Interchange',
    label: 'ARTEM-IS',
    extension: '.artemis.json',
    mimeType: 'application/json;charset=utf-8',
  },
];

export const IMPORTABLE_EXTENSIONS: string[] = EXPORT_FORMATS
  .filter((format) => format.importable)
  .flatMap((format) => [format.extension, ...(format.alsoReads ?? [])]);

/**
 * A jsPsych timeline is not an export format — nothing here writes one — but opening one converts
 * it to a studyflow, so the open picker has to offer it alongside the formats it round-trips.
 */
export const JSPSYCH_EXTENSION = '.json';

/** Everything "Open" accepts, which is every importable format plus the foreign ones it converts. */
export const OPENABLE_EXTENSIONS: string[] = [...IMPORTABLE_EXTENSIONS, JSPSYCH_EXTENSION];

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
const mimeEssence = (format: ExportFormat): string => format.mimeType.split(';')[0];

/** Every extension the open picker should offer, grouped the way `FilePickerAcceptType` wants it. */
export const OPENABLE_ACCEPT: Record<string, string[]> = EXPORT_FORMATS
  .filter((format) => format.importable)
  .reduce<Record<string, string[]>>((accept, format) => {
    const mime = mimeEssence(format);
    accept[mime] = [...(accept[mime] ?? []), format.extension, ...(format.alsoReads ?? [])];
    return accept;
  }, { 'application/json': [JSPSYCH_EXTENSION] });

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
