import { getCatalog, type AttributeSpec } from '@/core/catalog';
import { StudyflowElement } from '@/core/extensions';

/**
 * What the interchange exporters (LinkML, NIDM, ARTEM-IS) read out of a
 * diagram, resolved through the catalog rather than through per-exporter type
 * lists.
 *
 * An exporter asks for "the data elements" or "the instruments"; the schemas
 * say which types those are by declaring `meta.roles`. Adding a dataset type
 * to a schema therefore lands in every export at once, and none of the
 * exporters names a type.
 */

export type ExportedElement = {
  id: string;
  name: string;
  /** Qualified schema type, e.g. `studyflow:Timeseries`. */
  type: string;
  documentation?: string;
  /** Every catalog-declared attribute that carries a value, by local name. */
  attributes: Record<string, unknown>;
  /** The attribute definitions behind `attributes`, for consumers that need types. */
  specs: AttributeSpec[];
};

/** Whether an element's type carries `role` (inherited roles included). */
export function hasRole(businessObject: any, role: string): boolean {
  return getCatalog().hasRole(businessObject?.$type, role);
}

/**
 * Read every catalog-declared attribute of an element through the
 * `StudyflowElement` handle.
 *
 * This replaces the hardcoded probe lists the exporters used to carry (which
 * drifted from the schemas) and reaches values stored on extension wrappers
 * that a raw business-object read would miss.
 */
export function readExportedElement(businessObject: any, fallbackId?: string): ExportedElement {
  const element = StudyflowElement.fromBusinessObject(businessObject);
  const id = businessObject.id || fallbackId || '';

  const attributes: Record<string, unknown> = {};
  const specs: AttributeSpec[] = [];
  for (const spec of element.attributes()) {
    const key = spec.ns.localName;
    if (!key) continue;
    const value = element.read(key);
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    attributes[key] = toSerializable(value);
    specs.push(spec);
  }

  return {
    id,
    name: (businessObject.name as string | undefined) || id,
    type: businessObject.$type as string,
    documentation: element.read('documentation') as string | undefined,
    attributes,
    specs,
  };
}

/** Moddle references resolve to their id so the value stays serializable. */
function toSerializable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toSerializable);
  if (value && typeof value === 'object') {
    const id = (value as any).id;
    return typeof id === 'string' ? id : JSON.stringify(value);
  }
  return value;
}

/** `samplingRate` -> `sampling_rate`, the spelling interchange formats use. */
export function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
