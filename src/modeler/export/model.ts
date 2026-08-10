import { getCatalog, type AttributeSpec, type TypeRole } from '@/core/notation';
import { isDataOperationActivity, StudyflowElement } from '@/core/element';
import { exportDiagramName } from '@/modeler/export/common';
import type { Modeler } from '@/modeler/bpmn/types';

/**
 * What the interchange exporters read instead of the canvas: one pass over the
 * element registry, resolved against the catalog once.
 *
 * Each exporter is then a pure `ExportModel -> string` — no bpmn-js, no moddle,
 * no walk of its own — so *what an export sees* is decided here, once, instead
 * of separately in LinkML, NIDM, and ARTEM-IS.
 *
 * The draw.io exporter is deliberately not a consumer: it projects geometry and
 * diagram interchange (positions, waypoints, DI colors, mxGraph styles), which
 * this model does not carry and the semantic exporters never ask for.
 */
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
  /** Catalog roles of both the BPMN type and the schema type. */
  roles: readonly TypeRole[];
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

export function hasRole(element: ExportedElement, role: TypeRole): boolean {
  return element.roles.includes(role);
}

/** The one registry walk the interchange exporters are built from. */
export function buildExportModel(modeler: Modeler): ExportModel {
  const elements: ExportedElement[] = [];
  modeler.get('elementRegistry').forEach((el: any) => {
    if (el.type === 'label') return;
    if (!el.businessObject) return;
    elements.push(readElement(el.businessObject, el.id));
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

function readElement(businessObject: any, fallbackId?: string): ExportedElement {
  const element = StudyflowElement.fromBusinessObject(businessObject);
  const id = businessObject.id || fallbackId || '';
  const isDataOperation = isDataOperationActivity(businessObject);
  const roles = rolesOf(businessObject, element);

  const attributes: Record<string, unknown> = {};
  const specs: AttributeSpec[] = [];
  for (const spec of declaredAttributes(element)) {
    const key = spec.ns.localName;
    if (!key) continue;
    const value = element.getAttribute(key);
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    attributes[key] = toSerializable(value);
    specs.push(spec);
  }

  return {
    id,
    name: (businessObject.name as string | undefined) || id,
    type: schemaTypeOf(businessObject, element) as string,
    documentation: element.getAttribute('documentation') as string | undefined,
    attributes,
    specs,
    roles,
    isDataElement: roles.includes('data-element'),
    isDataOperation,
    inputs: isDataOperation ? associatedIds(businessObject, 'inputs') : [],
    outputs: isDataOperation ? associatedIds(businessObject, 'outputs') : [],
  };
}

/** A wrapper element carries roles under both its BPMN host type and the schema type it wraps. */
function rolesOf(businessObject: any, element: StudyflowElement): TypeRole[] {
  const catalog = getCatalog();
  const roles = new Set<TypeRole>();
  for (const name of [businessObject?.$type as string | undefined, element.extensionType]) {
    for (const role of catalog.getType(name ?? '')?.roles ?? []) roles.add(role);
  }
  return [...roles];
}

function schemaTypeOf(businessObject: any, element: StudyflowElement): string | undefined {
  return element.extensionType ?? (businessObject?.$type as string | undefined);
}

function declaredAttributes(element: StudyflowElement): AttributeSpec[] {
  const specs = element.attributes();
  const seen = new Set(specs.map((spec) => spec.ns.localName));
  for (const spec of element.extensionAttributes()) {
    if (seen.has(spec.ns.localName)) continue;
    seen.add(spec.ns.localName);
    specs.push(spec);
  }
  return specs;
}

function associatedIds(bo: any, direction: 'inputs' | 'outputs'): string[] {
  const listName = direction === 'inputs' ? 'dataInputAssociations' : 'dataOutputAssociations';
  const associations: any[] = bo?.get?.(listName) ?? bo?.[listName] ?? [];
  return associations.flatMap((association) => {
    const ends: { id?: unknown }[] = direction === 'inputs'
      ? association?.get?.('sourceRef') ?? association?.sourceRef ?? []
      : [association?.get?.('targetRef') ?? association?.targetRef];
    return ends
      .map((end) => end?.id)
      .filter((id): id is string => typeof id === 'string' && id !== '');
  });
}

function toSerializable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toSerializable);
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' ? id : JSON.stringify(value);
  }
  return value;
}
