import { getCatalog, type AttributeSpec, type TypeTag } from '@core/notation';
import { idOf, isElement, yamlText, type Element, type StudyModel, type Value } from '@core/model/index';
import { isDataOperationIn } from '@core/model/parameters';
import { exportDiagramName } from '@modeler/diagram/name';
import type { Editor } from '@modeler/editor/port';

/* exporters read this instead of the canvas */
export type ExportedElement = {
  id: string;
  /** The element's name, or its id where it has none. */
  name: string;
  /** The schema type where the element has one, its BPMN type otherwise. */
  type: string;
  documentation?: string;
  /** Declared attributes that carry a value, keyed by local name. */
  attributes: Record<string, unknown>;
  specs: AttributeSpec[];
  /** The tags of both its BPMN type and its schema type (`meta.tags`). */
  typeTags: readonly TypeTag[];
  isDataElement: boolean;
  isDataOperation: boolean;
  /** Ids of the elements this one reads and writes; empty unless `isDataOperation`. */
  inputs: readonly string[];
  outputs: readonly string[];
};

export type ExportModel = {
  diagramName: string;
  /** Every element the registry holds, in registry order. */
  elements: readonly ExportedElement[];
  dataElements: readonly ExportedElement[];
  dataElementIds: ReadonlySet<string>;
  operations: readonly ExportedElement[];
  byId: ReadonlyMap<string, ExportedElement>;
};

export function hasTag(element: ExportedElement, tag: TypeTag): boolean {
  return element.typeTags.includes(tag);
}

/** The one walk over the study the interchange exporters are built from. */
export function buildExportModel(modeler: Editor): ExportModel {
  const { study } = modeler;
  const { model } = study;
  const elements = study.list().flatMap((record) => {
    const element = model.get(record.id);
    return element ? [readElement(model, element)] : [];
  });

  const dataElements = elements.filter((element) => element.isDataElement);

  return {
    diagramName: exportDiagramName(modeler),
    elements,
    dataElements,
    dataElementIds: new Set(dataElements.map((element) => element.id)),
    operations: elements.filter((element) => element.isDataOperation),
    byId: new Map(elements.map((element) => [element.id, element])),
  };
}

function readElement(model: StudyModel, element: Element): ExportedElement {
  const id = element.id ?? '';
  const host = model.host(element);
  const extensionType = model.extensionType(element);
  const typeTags = typeTagsOf(host, extensionType);
  const isDataOperation = isDataOperationIn(model, element);

  const attributes: Record<string, unknown> = {};
  const specs: AttributeSpec[] = [];
  for (const spec of declaredAttributes(host, extensionType)) {
    const key = spec.ns.localName;
    if (!key) continue;
    const value = model.attributeOrDefault(element, key);
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    attributes[key] = toSerializable(value);
    specs.push(spec);
  }
  const documentation = listIn(element.documentation)
    .map((entry) => (isElement(entry) ? entry.text : entry))
    .filter((text): text is string => typeof text === 'string');

  return {
    id,
    name: (typeof element.name === 'string' && element.name) || id,
    type: extensionType ?? host,
    documentation: documentation.length > 0 ? documentation.join('\n\n') : undefined,
    attributes,
    specs,
    typeTags,
    isDataElement: typeTags.includes('data-element'),
    isDataOperation,
    inputs: isDataOperation ? listIn(element.dataInputAssociations).filter(isElement).flatMap((association) => listIn(association.sourceRef).map(idOf)).filter(isId) : [],
    outputs: isDataOperation ? listIn(element.dataOutputAssociations).filter(isElement).map((association) => idOf(association.targetRef)).filter(isId) : [],
  };
}

const listIn = (value: Value | undefined): Value[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

const isId = (id: string | null): id is string => typeof id === 'string' && id !== '';

/** A wrapper element carries tags under both its BPMN host type and the schema type it wraps. */
function typeTagsOf(host: string, extensionType: string | undefined): TypeTag[] {
  const catalog = getCatalog();
  const tags = new Set<TypeTag>();
  for (const name of [host, extensionType]) {
    for (const tag of catalog.getType(name ?? '')?.tags ?? []) tags.add(tag);
  }
  return [...tags];
}

function declaredAttributes(host: string, extensionType: string | undefined): AttributeSpec[] {
  const catalog = getCatalog();
  const specs = [...catalog.instanceAttributesOf(host)];
  const seen = new Set(specs.map((spec) => spec.ns.localName));
  for (const spec of extensionType ? catalog.instanceAttributesOf(extensionType) : []) {
    if (seen.has(spec.ns.localName)) continue;
    seen.add(spec.ns.localName);
    specs.push(spec);
  }
  return specs;
}

/** A value as text an exporter writes: a reference by its id, a YAML-typed mapping as its text. */
function toSerializable(value: Value): unknown {
  if (Array.isArray(value)) return value.map(toSerializable);
  if (isElement(value)) return typeof value.id === 'string' ? value.id : JSON.stringify(value);
  if (value && typeof value === 'object') return yamlText(value);
  return value;
}
