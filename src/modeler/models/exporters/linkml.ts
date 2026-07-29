/**
 * LinkML exporter for the data elements of a Studyflow diagram.
 *
 * Walks every element whose type declares the `data-element` role (Schema,
 * Dataset, Table, Timeseries, EventMarker, DataCatalog in the core schema, plus
 * whatever an extension adds) and emits a LinkML schema instance. Classes carry
 * a `class_uri` pointing back to the Studyflow type, and each attribute's
 * `range` and `description` come from the schema that declares it — this file
 * names no type and no field.
 */

import * as yaml from 'js-yaml';
import { getCatalog, type AttributeSpec } from '@/core/catalog';
import { getDiagramName } from '@/modeler/models/diagramName';
import { forEachBusinessObject } from '@/modeler/models/exporters/common';
import {
  hasRole,
  readExportedElement,
  type ExportedElement,
} from '@/modeler/models/exporters/dataElements';

const EXPORT_NS = 'https://behaverse.org/schemas/studyflow/';

function toIdentifier(s: string): string {
  return s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'Element';
}

function collectDataElements(modeler: any): ExportedElement[] {
  const out: ExportedElement[] = [];
  forEachBusinessObject(modeler, (bo, el) => {
    if (!hasRole(bo, 'data-element')) return;
    out.push(readExportedElement(bo, el?.id));
  });
  return out;
}

/**
 * LinkML range for an attribute, from its declared moddle type.
 *
 * A ref to another exported class ranges over that class (`Dataset#schema`
 * over `Schema`); everything else maps onto a LinkML built-in. The old
 * hand-written `rowCount -> integer` table is gone — the schemas already say
 * what each attribute is.
 */
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

  // A ref to a type that is itself exported ranges over that class.
  const target = getCatalog().getType(spec.type);
  if (target && getCatalog().hasRole(target.name, 'data-element')) return target.ns.localName;

  // Value types (MarkdownString, YAMLString, ...) are strings on the wire; a
  // URL-ish name reads better as a `uri`.
  if (/^(uri|url)$/i.test(spec.ns.localName)) return 'uri';
  return 'string';
}

export function exportToLinkML(modeler: any): string {
  const elements = collectDataElements(modeler);
  const diagramName = getDiagramName(modeler) ?? 'studyflow_export';
  const id = `${EXPORT_NS}exports/${toIdentifier(diagramName)}.linkml`;

  const classes: Record<string, any> = {};
  for (const element of elements) {
    const className = toIdentifier(element.name);
    // Disambiguate name collisions by suffixing with the element id.
    const key = classes[className] ? `${className}_${toIdentifier(element.id)}` : className;
    classes[key] = buildClass(element);
  }

  const doc: Record<string, any> = {
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

function buildClass(element: ExportedElement): Record<string, any> {
  const cls: Record<string, any> = {
    description: element.documentation ?? `${element.type.split(':')[1]} from the Studyflow diagram.`,
    class_uri: element.type,
  };

  const annotations: Record<string, unknown> = {
    studyflow_id: element.id,
    studyflow_type: element.type,
  };
  if (element.attributes.format) annotations.format = element.attributes.format;
  cls.annotations = annotations;

  const attributes: Record<string, any> = {};
  for (const spec of element.specs) {
    const name = spec.ns.localName;
    const attribute: Record<string, any> = { range: rangeOf(spec) };
    if (spec.isMany) attribute.multivalued = true;
    // The schema's own prose is the field documentation; nothing is restated here.
    const description = spec.description?.trim();
    if (description) attribute.description = description;
    attributes[name] = attribute;
  }

  if (Object.keys(attributes).length > 0) cls.attributes = attributes;
  return cls;
}
