/**
 * LinkML exporter for the data elements of a Studyflow diagram.
 *
 * Walks Schema / Dataset / Table / Array / Snapshot / Timeseries / Event
 * elements and emits a LinkML schema instance. Classes carry a `class_uri`
 * pointing back to the Studyflow type.
 */

import * as yaml from 'js-yaml';
import { getDiagramName } from '../diagramName';
import { forEachBusinessObject, readField } from './common';

const STUDYFLOW_NS = 'https://behaverse.org/schemas/studyflow/';

type DataElement = {
  id: string;
  name: string;
  type: string;
  documentation?: string;
  attrs: Record<string, unknown>;
};

const DATA_ELEMENT_TYPES = new Set([
  'studyflow:Schema',
  'studyflow:Dataset',
  'studyflow:Table',
  'studyflow:Array',
  'studyflow:Snapshot',
  'studyflow:Timeseries',
  'studyflow:EventMarker',
  'studyflow:DataCatalog',
  'studyflow:DataStorage',
]);

function toIdentifier(s: string): string {
  return s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'Element';
}

function readDataElement(bo: any, el: any): DataElement | null {
  const type = bo.$type as string;
  if (!DATA_ELEMENT_TYPES.has(type)) return null;

  const id = bo.id || el.id || `el_${Math.random().toString(36).slice(2, 8)}`;
  const name = (bo.name as string | undefined) || id;
  const documentation = readField(bo, 'documentation') as string | undefined;

  const attrs: Record<string, unknown> = {};
  // Probe the union of known attribute names across the data-element classes.
  const PROBES = [
    'format', 'schemaRef', 'inlineSchema', 'rowCount',
    'samplingRate', 'channelCount', 'units', 'recordingDuration',
    'eventType', 'onset', 'offset', 'eventCount',
    'catalog', 'storage', 'schema', 'bdmDataLevel', 'bidsDataType',
    'url', 'source', 'version', 'dataset', 'state', 'body',
  ];
  for (const p of PROBES) {
    const v = readField(bo, p);
    if (v !== undefined && v !== null && v !== '') {
      // Resolve moddle references to their id so YAML stays serializable.
      if (typeof v === 'object' && (v as any).id) {
        attrs[p] = (v as any).id;
      } else if (typeof v === 'object') {
        attrs[p] = JSON.stringify(v);
      } else {
        attrs[p] = v;
      }
    }
  }
  return { id, name, type, documentation, attrs };
}

function collectDataElements(modeler: any): DataElement[] {
  const out: DataElement[] = [];
  forEachBusinessObject(modeler, (bo, el) => {
    const item = readDataElement(bo, el);
    if (item) out.push(item);
  });
  return out;
}

/** Types whose `schema` reference ranges over another exported class. */
const SCHEMA_RANGE_TYPES = new Set(['studyflow:Dataset', 'studyflow:Table']);

/** Map a Studyflow type to a LinkML range hint for the auto-generated class. */
function rangeForStudyflowType(type: string): string | undefined {
  return SCHEMA_RANGE_TYPES.has(type) ? 'Schema' : undefined;
}

export function exportToLinkML(modeler: any): string {
  const elements = collectDataElements(modeler);
  const diagramName = getDiagramName(modeler) ?? 'studyflow_export';
  const id = `${STUDYFLOW_NS}exports/${toIdentifier(diagramName)}.linkml`;

  const classes: Record<string, any> = {};
  for (const e of elements) {
    const className = toIdentifier(e.name);
    if (classes[className]) {
      // Disambiguate name collisions by suffixing with id.
      const alt = `${className}_${toIdentifier(e.id)}`;
      classes[alt] = buildClass(e);
    } else {
      classes[className] = buildClass(e);
    }
  }

  const doc: Record<string, any> = {
    id,
    name: toIdentifier(diagramName).toLowerCase(),
    title: `${diagramName}`,
    description: `Auto-generated LinkML schema for the data elements of the Studyflow diagram "${diagramName}". Each class carries a class_uri pointing back to its Studyflow type.`,
    license: 'MIT',
    prefixes: {
      linkml: 'https://w3id.org/linkml/',
      studyflow: STUDYFLOW_NS,
      bids: 'https://bids-specification.readthedocs.io/',
      psychds: 'https://psych-ds.github.io/',
      bdm: 'https://behaverse.org/data-model/',
      csvw: 'http://www.w3.org/ns/csvw#',
    },
    default_prefix: 'studyflow',
    imports: ['linkml:types'],
  };

  if (Object.keys(classes).length === 0) {
    doc.classes = {
      EmptyDataPlane: {
        description: 'No Schema / Dataset / Table / Array / Snapshot / Timeseries / Event elements were found in this diagram. Add data-plane elements to populate the export.',
      },
    };
  } else {
    doc.classes = classes;
  }

  return yaml.dump(doc, { lineWidth: 100, sortKeys: false, noRefs: true });
}

function buildClass(e: DataElement): Record<string, any> {
  const cls: Record<string, any> = {
    description: e.documentation ?? `${e.type.split(':')[1]} from the Studyflow diagram.`,
    class_uri: e.type,
  };
  const annotations: Record<string, unknown> = {
    studyflow_id: e.id,
    studyflow_type: e.type,
  };
  if (e.attrs.format) annotations.format = e.attrs.format;
  cls.annotations = annotations;

  // Map known scalar fields into LinkML attributes so the class is non-empty.
  const attrs: Record<string, any> = {};
  if (e.attrs.schemaRef) attrs.schemaRef = { range: 'uri', description: 'External CSVW or LinkML schema URI.' };
  if (e.attrs.inlineSchema) attrs.inlineSchema = { range: 'string', description: 'Inline CSVW JSON-LD or LinkML YAML content.' };
  if (e.attrs.rowCount !== undefined) attrs.rowCount = { range: 'integer' };
  if (e.attrs.samplingRate !== undefined) attrs.samplingRate = { range: 'float', description: 'Samples per second (Hz).' };
  if (e.attrs.channelCount !== undefined) attrs.channelCount = { range: 'integer' };
  if (e.attrs.units !== undefined) attrs.units = { range: 'string' };
  if (e.attrs.recordingDuration !== undefined) attrs.recordingDuration = { range: 'float', description: 'Recording duration in seconds.' };
  if (e.attrs.eventType !== undefined) attrs.eventType = { range: 'string' };
  if (e.attrs.onset !== undefined) attrs.onset = { range: 'float' };
  if (e.attrs.offset !== undefined) attrs.offset = { range: 'float' };
  if (e.attrs.eventCount !== undefined) attrs.eventCount = { range: 'integer' };
  if (e.attrs.url !== undefined) attrs.url = { range: 'uri' };
  if (e.attrs.source !== undefined) attrs.source = { range: 'string' };
  if (e.attrs.version !== undefined) attrs.version = { range: 'string' };

  const schemaRange = rangeForStudyflowType(e.type);
  if (e.attrs.schema) attrs.schema = { range: schemaRange ?? 'string', description: 'Linked schema reference.' };

  if (Object.keys(attrs).length > 0) {
    cls.attributes = attrs;
  }
  return cls;
}
