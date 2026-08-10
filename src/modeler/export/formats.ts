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

/** Every compound extension the catalog declares, longest first so the longest match wins. */
export const COMPOUND_EXTENSIONS: string[] = EXPORT_FORMATS
  .map((format) => format.extension)
  .filter((extension) => extension.split('.').length > 2)
  .sort((a, b) => b.length - a.length);

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

export type EmbedOptionId = 'studyflow' | 'drawio';

export type EmbedOptions = Record<EmbedOptionId, boolean>;

export const EMBED_OPTIONS: Array<{ id: EmbedOptionId; label: string; description: string }> = [
  {
    id: 'studyflow',
    label: 'Studyflow source',
    description: 'The exported image opens back in this modeler.',
  },
  {
    id: 'drawio',
    label: 'draw.io diagram',
    description: 'The same file opens as an editable diagram in draw.io.',
  },
];

export const DEFAULT_EMBED_OPTIONS: EmbedOptions = { studyflow: true, drawio: true };

export function exportFilename(name: string, format: ExportFormat): string {
  return `${name}${format.extension}`;
}
