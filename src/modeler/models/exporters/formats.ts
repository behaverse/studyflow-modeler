/**
 * The catalog of formats a diagram can leave the app in.
 *
 * One list, read by both the Export dialog (which renders it) and the export
 * controller (which serializes to it), so adding a format is a single edit.
 * The native `.studyflow` YAML is an entry like any other here: saving is just
 * exporting to the format the modeler happens to read back.
 */
import { ICONS } from '@/icons';

export type ExportFormatId =
  | 'studyflow'
  | 'bpmn'
  | 'svg'
  | 'png'
  | 'drawio'
  | 'linkml'
  | 'nidm'
  | 'artemis';

/** Section the format renders under in the dialog; also its display order. */
export type ExportFormatGroup = 'Diagram' | 'Image' | 'Interchange';

export type ExportFormat = {
  id: ExportFormatId;
  group: ExportFormatGroup;
  label: string;
  /** Appended to the diagram name to form the download filename. */
  extension: string;
  mimeType: string;
  icon: string;
  /** One line, shown under the label in the dialog. */
  description: string;
  /**
   * Images can carry the payloads in {@link EMBED_OPTIONS}, which is what makes
   * an exported figure reopenable rather than a flat picture.
   */
  embeddable?: boolean;
  /**
   * The modeler reads this format back. Extra spellings the same reader
   * accepts (`.xml` for BPMN) go in `alsoReads`, so the file picker's accept
   * list is this catalog rather than a second list beside it.
   */
  importable?: boolean;
  alsoReads?: string[];
};

export const EXPORT_FORMATS: ExportFormat[] = [
  {
    id: 'studyflow',
    group: 'Diagram',
    label: 'Studyflow',
    // `.studyflow.*` is one convention across the family: the part before the
    // last dot says what the file is, the part after it how it is encoded —
    // and editors, Git hosts, and pipelines treat the `.yaml` half natively.
    extension: '.studyflow.yaml',
    mimeType: 'text/yaml;charset=utf-8',
    icon: ICONS.fileYaml,
    description: 'Native YAML source. Diffs cleanly in Git.',
    importable: true,
    alsoReads: ['.studyflow'],
  },
  {
    id: 'bpmn',
    group: 'Diagram',
    label: 'BPMN 2.0 XML',
    extension: '.bpmn',
    mimeType: 'application/xml;charset=utf-8',
    icon: ICONS.fileXml,
    description: 'Standard BPMN, for interop with other BPMN tooling.',
    importable: true,
    alsoReads: ['.xml'],
  },
  {
    id: 'svg',
    group: 'Image',
    label: 'SVG',
    extension: '.studyflow.svg',
    mimeType: 'image/svg+xml;charset=utf-8',
    icon: ICONS.fileSvg,
    description: 'Vector figure for manuscripts and web pages.',
    embeddable: true,
    importable: true,
    alsoReads: ['.svg'],
  },
  {
    id: 'png',
    group: 'Image',
    label: 'PNG',
    // The double extension is the `.drawio.png` convention: it marks the
    // image as a *source* that happens to render everywhere, so a copy that
    // lost its payload to a re-encoding editor is recognizably a plain `.png`.
    extension: '.studyflow.png',
    mimeType: 'image/png',
    icon: ICONS.filePng,
    description: 'Raster figure for slides and quick sharing.',
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
    icon: ICONS.diagram,
    description: 'Editable diagram for draw.io / diagrams.net.',
  },
  {
    id: 'linkml',
    group: 'Interchange',
    label: 'LinkML schema',
    extension: '.linkml.yaml',
    mimeType: 'text/yaml;charset=utf-8',
    icon: ICONS.fileYaml,
    description: "The diagram's data elements, for validation tooling.",
  },
  {
    id: 'nidm',
    group: 'Interchange',
    label: 'NIDM-Results',
    extension: '.nidm.ttl',
    mimeType: 'text/turtle;charset=utf-8',
    icon: ICONS.database,
    description: 'Analysis metadata as RDF, for neuroimaging provenance.',
  },
  {
    id: 'artemis',
    group: 'Interchange',
    label: 'ARTEM-IS',
    extension: '.artemis.json',
    mimeType: 'application/json;charset=utf-8',
    icon: ICONS.fileJson,
    description: 'EEG methods descriptor following the ARTEM-IS template.',
  },
];

/**
 * Extensions the modeler opens — every format that declares `importable`, plus
 * the extra spellings its reader accepts. The Open dialog's accept list and its
 * drop-target check both read this, so a new readable format is one entry above.
 */
export const IMPORTABLE_EXTENSIONS: string[] = EXPORT_FORMATS
  .filter((format) => format.importable)
  .flatMap((format) => [format.extension, ...(format.alsoReads ?? [])]);

/** Groups in display order, each with its formats. */
export const EXPORT_FORMAT_GROUPS: Array<[ExportFormatGroup, ExportFormat[]]> = (
  ['Diagram', 'Image', 'Interchange'] as ExportFormatGroup[]
).map((group) => [group, EXPORT_FORMATS.filter((format) => format.group === group)]);

export function getExportFormat(id: ExportFormatId): ExportFormat {
  const format = EXPORT_FORMATS.find((candidate) => candidate.id === id);
  if (!format) throw new Error(`Unknown export format: ${id}`);
  return format;
}

/** Payloads an image export can carry alongside the picture. */
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

/** Download filename for `format`; `name` is the diagram name, unextended. */
export function exportFilename(name: string, format: ExportFormat): string {
  return `${name}${format.extension}`;
}
