import * as yaml from 'js-yaml';
import { getCatalog, type AttributeSpec } from '@core/notation';
import type { ExportedElement, ExportModel } from '@modeler/export/model';

const EXPORT_NS = 'https://behaverse.org/schemas/studyflow/';

function toIdentifier(s: string): string {
  return s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'Element';
}

const BUILTIN_RANGES: Record<string, string> = {
  String: 'string',
  Boolean: 'boolean',
  Integer: 'integer',
  Real: 'float',
  Float: 'float',
  Double: 'double',
};

function rangeOf(spec: AttributeSpec): string {
  if (spec.isEnum) return 'string';
  const builtin = BUILTIN_RANGES[spec.type];
  if (builtin) return builtin;

  const target = getCatalog().getType(spec.type);
  if (target && getCatalog().hasRole(target.name, 'data-element')) return target.ns.localName;

  if (/^(uri|url)$/i.test(spec.ns.localName)) return 'uri';
  return 'string';
}

export function exportToLinkML(model: ExportModel): string {
  const diagramName = model.diagramName;
  const id = `${EXPORT_NS}exports/${toIdentifier(diagramName)}.linkml`;

  const classes: Record<string, unknown> = {};
  for (const element of model.dataElements) {
    const className = toIdentifier(element.name);
    const key = classes[className] ? `${className}_${toIdentifier(element.id)}` : className;
    classes[key] = buildClass(element);
  }

  const doc: Record<string, unknown> = {
    id,
    name: toIdentifier(diagramName).toLowerCase(),
    title: `${diagramName}`,
    description: `Auto-generated LinkML schema for the data elements of the Studyflow diagram "${diagramName}". Each class carries a class_uri pointing back to its Studyflow type.`,
    license: 'MIT',
    prefixes: {
      linkml: 'https://w3id.org/linkml/',
      studyflow: EXPORT_NS,
      bids: 'https://bids-specification.readthedocs.io/',
      psychds: 'https://psych-ds.github.io/',
      bdm: 'https://behaverse.org/data-model/',
      csvw: 'http://www.w3.org/ns/csvw#',
    },
    default_prefix: 'studyflow',
    imports: ['linkml:types'],
  };

  doc.classes = Object.keys(classes).length > 0 ? classes : {
    EmptyDataPlane: {
      description: 'No data-plane elements were found in this diagram. Add a Schema, Dataset, Table, Timeseries, or Event element to populate the export.',
    },
  };

  return yaml.dump(doc, { lineWidth: 100, sortKeys: false, noRefs: true });
}

function buildClass(element: ExportedElement): Record<string, unknown> {
  const cls: Record<string, unknown> = {
    description: element.documentation ?? `${element.type.split(':')[1]} from the Studyflow diagram.`,
    class_uri: element.type,
  };

  const annotations: Record<string, unknown> = {
    studyflow_id: element.id,
    studyflow_type: element.type,
  };
  if (element.attributes.format) annotations.format = element.attributes.format;
  cls.annotations = annotations;

  const attributes: Record<string, unknown> = {};
  for (const spec of element.specs) {
    const name = spec.ns.localName;
    const attribute: Record<string, unknown> = { range: rangeOf(spec) };
    if (spec.isMany) attribute.multivalued = true;
    const description = spec.description?.trim();
    if (description) attribute.description = description;
    attributes[name] = attribute;
  }

  if (Object.keys(attributes).length > 0) cls.attributes = attributes;
  return cls;
}
