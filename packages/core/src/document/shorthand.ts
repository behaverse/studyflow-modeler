import { BPMN_FORMAL_EXPRESSION } from '@core/model/spelling';

/* The short forms read into moddle's tree, in the order a reader meets them; each one is reversible, and the long form
   is always accepted. Specified for authors in docs/reference.qmd, "The file"; pinned by
   packages/core/tests/studyflow-yaml.unit.spec.ts. The study model reads and writes them (`@core/model/yaml`). */

/* 1. yaml-value */

/* 2. element-list */

export function elementListProperty(descriptor: any): any | undefined {
  // BPMN's own list holders only (`extensionElements`): a schema's element with one list is an entry, not a list.
  if (descriptor?.ns?.prefix !== 'bpmn') return undefined;
  const props: any[] = descriptor?.properties ?? [];
  const content = props.filter((p) => !p.isAttr && !p.isReference && !p.isBody);
  return content.length === 1 && content[0].isMany ? content[0] : undefined;
}

/* 3. inline-di */

export type DiType = 'bpmndi:BPMNShape' | 'bpmndi:BPMNEdge';

function diTypeFor(keys: { has: (key: string) => boolean }, ownByName: Record<string, any>): DiType | undefined {
  if (keys.has('bounds') && !ownByName['bounds']) return 'bpmndi:BPMNShape';
  if (keys.has('waypoint') && !ownByName['waypoint']) return 'bpmndi:BPMNEdge';
  return undefined;
}

export function extractInlineDi(
  props: Record<string, any>,
  ownByName: Record<string, any>,
  diPropertiesByName: (type: DiType) => Record<string, any>,
): { type: DiType; props: Record<string, unknown> } | undefined {
  const keys = { has: (key: string) => key in props };
  const diType = diTypeFor(keys, ownByName);
  if (!diType) return undefined;

  const diByName = diPropertiesByName(diType);
  const diProps: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === 'id' || ownByName[key] || !diByName[key]) continue;
    diProps[key] = props[key];
    delete props[key];
  }
  return { type: diType, props: diProps };
}

/* 5. expression-body */

/** `bpmn:Expression` is abstract, so a flat string always rebuilds as the concrete `bpmn:FormalExpression`. */
export function expandExpressionBody(text: string): Record<string, unknown> {
  return { type: BPMN_FORMAL_EXPRESSION, body: text };
}

/* 6. documentation */

export const DOCUMENTATION_TYPE = 'bpmn:Documentation';

export function isDocumentationType(typeName: string | undefined): boolean {
  return typeName === DOCUMENTATION_TYPE;
}

export function isDocumentationProperty(prop: any): boolean {
  return isDocumentationType(prop?.type);
}

export function expandDocumentationEntry(text: string): Record<string, unknown> {
  return { type: DOCUMENTATION_TYPE, text };
}

/* typed element */

/**
 * The BPMN element a schema's wrapper type attaches to (`cognitive:Questionnaire` → `bpmn:Task`), its own or a wrapper
 * it inherits from; none for any other type. moddle keeps it as the type's `meta.attachesTo` (`toModdlePackages`).
 */
export function attachOf(moddle: any, type: string, seen = new Set<string>()): string | undefined {
  const entry = moddle?.registry?.typeMap?.[type];
  if (!entry || seen.has(type)) return undefined;
  seen.add(type);
  if (typeof entry.meta?.attachesTo === 'string') return entry.meta.attachesTo;
  for (const parent of entry.superClass ?? []) {
    const name = String(parent).includes(':') ? String(parent) : `${type.split(':')[0]}:${parent}`;
    const found = attachOf(moddle, name, seen);
    if (found) return found;
  }
  return undefined;
}

function declaredKeys(moddle: any, type: string): Set<string> {
  let descriptor: any;
  try {
    descriptor = moddle.getElementDescriptor(moddle.create(type));
  } catch {
    return new Set();
  }
  return new Set((descriptor.properties ?? []).map((p: any) => p.ns?.localName ?? p.name));
}

/**
 * A typed element read back: `type: <wrapper>` becomes the BPMN element it attaches to, with a wrapper entry holding
 * the keys the wrapper declares and the element's type does not. `undefined` when `type` names no wrapper.
 */
export function unfoldTypedElement(moddle: any, node: Record<string, any>, type: string): Record<string, any> | undefined {
  const host = attachOf(moddle, type);
  if (!host) return undefined;
  const own = declaredKeys(moddle, host);
  const wrapper = declaredKeys(moddle, type);
  const entry: Record<string, unknown> = { type };
  const element: Record<string, any> = { type: host };
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type') continue;
    if (wrapper.has(key) && !own.has(key)) entry[key] = value;
    else element[key] = value;
  }
  const list = element.extensionElements;
  element.extensionElements = Array.isArray(list) ? [entry, ...list]
    : list && typeof list === 'object' && Array.isArray(list.values) ? { ...list, values: [entry, ...list.values] }
    : [entry];
  return element;
}
