import { getCatalog, type AttributeSpec, type TypeRole } from '@/core/notation';
import { isDataOperationActivity, StudyflowElement } from '@/core/element';
import { forEachBusinessObject } from '@/modeler/export/common';
import type { Modeler } from '@/modeler/bpmn/types';

export type ExportedElement = {
  id: string;
  name: string;
  type: string;
  documentation?: string;
  attributes: Record<string, unknown>;
  specs: AttributeSpec[];
};

export type ExportedOperation = ExportedElement & {
  inputs: string[];
  outputs: string[];
};

export function hasRole(businessObject: any, role: TypeRole): boolean {
  const catalog = getCatalog();
  if (catalog.hasRole(businessObject?.$type, role)) return true;
  return catalog.hasRole(schemaTypeOf(businessObject), role);
}

function schemaTypeOf(businessObject: any): string | undefined {
  return StudyflowElement.fromBusinessObject(businessObject).extensionType
    ?? (businessObject?.$type as string | undefined);
}

export function readExportedElement(businessObject: any, fallbackId?: string): ExportedElement {
  const element = StudyflowElement.fromBusinessObject(businessObject);
  const id = businessObject.id || fallbackId || '';

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
    type: schemaTypeOf(businessObject) as string,
    documentation: element.getAttribute('documentation') as string | undefined,
    attributes,
    specs,
  };
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

export function collectDataElements(modeler: Modeler): ExportedElement[] {
  const out: ExportedElement[] = [];
  forEachBusinessObject(modeler, (bo, el) => {
    if (!hasRole(bo, 'data-element')) return;
    out.push(readExportedElement(bo, el?.id));
  });
  return out;
}

export function collectDataOperations(modeler: Modeler): ExportedOperation[] {
  const out: ExportedOperation[] = [];
  forEachBusinessObject(modeler, (bo, el) => {
    if (!isDataOperationActivity(bo)) return;
    out.push({
      ...readExportedElement(bo, el?.id),
      inputs: associatedIds(bo, 'inputs'),
      outputs: associatedIds(bo, 'outputs'),
    });
  });
  return out;
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

export function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
