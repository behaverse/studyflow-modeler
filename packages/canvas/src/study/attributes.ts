/**
 * The attributes an element takes, as data an AI reads to spell `set`: its name, and those its schema types declare
 * (its extension's, and the traits on its BPMN type), each named as the `.studyflow.yaml` file spells it, with what
 * it holds now. What the inspector shows, less its layout.
 */

import { getAttributeSpec, isExtensionPrefix } from '@core/element/index.ts';
import { readAttribute, type Element, type StudyModel } from '@core/model/index.ts';
import { getCatalog, hasCatalog, type AttributeSpec } from '@core/notation/index.ts';

export interface AttributeRecord {
  /** What `set` takes, as the document spells it: the local name, qualified only where two of the element's share it. */
  readonly name: string;
  /** What it holds: `String`, `Integer`, `Boolean`, `Real`, an enumeration or a schema type. */
  readonly type: string;
  readonly description?: string;
  /** It holds a list. */
  readonly many?: boolean;
  /** An enumeration's values: what `set` takes for it. */
  readonly values?: readonly unknown[];
  /** Shown in the inspector only while these attributes hold these values (`$set`: any value). */
  readonly when?: Readonly<Record<string, unknown>>;
  /** What it holds now, when that is plain JSON; a structured value is read in the document. */
  readonly value?: unknown;
}

/** The attributes `element` takes, in the inspector's order: its name, its type's, its extension's, its checklist. */
export function attributesOf(model: StudyModel, element: Element): AttributeRecord[] {
  const host = model.host(element);
  const extensionType = model.extensionType(element);
  const catalog = getCatalog();
  const extension = extensionType ? catalog.instanceAttributesOf(extensionType) : [];
  // What the extension redefines, it keeps: the BPMN type's own spelling of it steps aside.
  const redefined = new Set(extension.map((spec) => spec.redefinedName ?? localNameOf(spec)));
  const declared = (spec: AttributeSpec): boolean => isExtensionPrefix(spec.ns?.prefix) || !!spec.redefines;
  const name = getAttributeSpec(host, 'bpmn:name');
  const specs = [
    ...(name && (model.property(element, 'name') || element.name !== undefined) ? [name] : []),
    ...catalog.instanceAttributesOf(host).filter((spec) => declared(spec) && !redefined.has(localNameOf(spec))),
    ...extension.filter(declared),
  ].filter((spec, index, all) => !spec.meta?.pinned && all.findIndex((other) => keyOf(other) === keyOf(spec)) === index);
  const shared = new Set(specs.map(localNameOf).filter((local, index, all) => all.indexOf(local) !== index));
  return specs.map((spec): AttributeRecord => {
    const value = plain(readAttribute(model, element, localNameOf(spec)));
    const values = spec.isEnum && hasCatalog() ? getCatalog().enumOf(spec.type, spec.ns?.prefix)?.literals.map((literal) => literal.value) : undefined;
    // An attribute kept in an element's body (documentation, an expression) reads and writes as text.
    return {
      name: shared.has(localNameOf(spec)) ? keyOf(spec) : localNameOf(spec),
      type: spec.bodyProp ? 'String' : spec.type,
      ...(spec.description ? { description: spec.description } : {}),
      ...(spec.isMany && !spec.bodyProp ? { many: true } : {}),
      ...(values ? { values } : {}),
      ...(spec.meta?.condition ? { when: spec.meta.condition } : {}),
      ...(value === undefined ? {} : { value }),
    };
  });
}

function localNameOf(spec: AttributeSpec): string {
  return spec.ns?.localName ?? spec.name;
}

function keyOf(spec: AttributeSpec): string {
  return spec.ns?.name ?? spec.name;
}

/** `value` as plain JSON: text, a number, true or false, or a list of those; nothing for a structured value. */
function plain(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'object') return value;
  if (!Array.isArray(value)) return undefined;
  const items = value.map(plain);
  return items.every((item) => item !== undefined) && items.length > 0 ? items : undefined;
}
