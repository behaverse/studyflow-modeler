import { BPMN_FORMAL_EXPRESSION, isExpressionType } from '@core/model/spelling';
import { isModdleElement, type ModdleElement } from '@core/element/moddle';

/* The short forms, in the order a reader meets them; each one is reversible, and the long form is always accepted.
   Specified for authors in docs/reference.qmd, "The file"; pinned by packages/core/tests/studyflow-yaml.unit.spec.ts. */

/** Whether `el` holds nothing but `keepNames`: every other property unset, empty or at its default. */
function hasOnlyProperties(el: ModdleElement, keepNames: string[]): boolean {
  for (const p of el.$descriptor?.properties ?? []) {
    if (keepNames.includes(p.name)) continue;
    const value = el[p.name];
    if (value === undefined || value === null) continue;
    if (p.default !== undefined && value === p.default) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    return false;
  }
  return true;
}


/* 1. yaml-value */

/* 2. element-list */

export function elementListProperty(descriptor: any): any | undefined {
  // BPMN's own list holders only (`extensionElements`): a schema's element with one list is an entry, not a list.
  if (descriptor?.ns?.prefix !== 'bpmn') return undefined;
  const props: any[] = descriptor?.properties ?? [];
  const content = props.filter((p) => !p.isAttr && !p.isReference && !p.isBody);
  return content.length === 1 && content[0].isMany ? content[0] : undefined;
}

export function inlineElementList(
  el: any,
  serializeItem: (item: any) => unknown,
): unknown[] | undefined {
  const content = elementListProperty(el.$descriptor);
  if (!content) return undefined;
  if (Object.keys(el.$attrs ?? {}).length > 0) return undefined;
  if (!hasOnlyProperties(el, [content.name])) return undefined;
  const items = el[content.name];
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return items.map(serializeItem);
}

/* 3. inline-di */

/** These point at other DI elements, whose ids are regenerated on load. */
const NON_INLINABLE_DI_KEYS = new Set(['sourceElement', 'targetElement', 'choreographyActivityShape']);

export type DiType = 'bpmndi:BPMNShape' | 'bpmndi:BPMNEdge';

function diTypeFor(keys: { has: (key: string) => boolean }, ownByName: Record<string, any>): DiType | undefined {
  if (keys.has('bounds') && !ownByName['bounds']) return 'bpmndi:BPMNShape';
  if (keys.has('waypoint') && !ownByName['waypoint']) return 'bpmndi:BPMNEdge';
  return undefined;
}

function foldablePayload(
  pe: any,
  serializeElement: (el: any, declaredType: string) => Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (pe.$type !== 'bpmndi:BPMNShape' && pe.$type !== 'bpmndi:BPMNEdge') return undefined;
  if (Object.keys(pe.$attrs ?? {}).length > 0) return undefined;
  const node = serializeElement(pe, pe.$type);
  delete node.id; // regenerated as `<elementId>_di` on load
  delete node.bpmnElement;
  for (const key of Object.keys(node)) if (NON_INLINABLE_DI_KEYS.has(key)) return undefined;
  return node;
}

export function planInlineDi(
  definitions: any,
  serializeElement: (el: any, declaredType: string) => Record<string, unknown>,
): Map<string, Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  const seen = new Set<string>();
  for (const pe of definitions.diagrams?.[0]?.plane?.planeElement ?? []) {
    const refId = pe?.bpmnElement?.id;
    if (typeof refId !== 'string' || refId === '') continue;
    if (seen.has(refId)) {
      byId.delete(refId); // two planeElements for one element: ambiguous, so keep both in `diagram:`
      continue;
    }
    seen.add(refId);
    const payload = foldablePayload(pe, serializeElement);
    if (payload) byId.set(refId, payload);
  }
  return byId;
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

/** The instantiation marker the parser records on an `xsi:type`d element, not content. */
const XSI_TYPE = 'xsi:type';

function qualifiesAsInlineExpression(el: any): boolean {
  if (!isModdleElement(el) || !isExpressionType(el.$type)) return false;
  if (typeof el.body !== 'string' || el.body === '') return false;
  if (Object.keys(el.$attrs ?? {}).some((name) => name !== XSI_TYPE)) return false;
  return hasOnlyProperties(el, ['body']);
}

export function inlineExpressionBody(el: any): string | undefined {
  return qualifiesAsInlineExpression(el) ? el.body : undefined;
}

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

function qualifiesAsInlineEntry(item: any): boolean {
  if (!isModdleElement(item) || item.$type !== DOCUMENTATION_TYPE) return false;
  if (typeof item.text !== 'string' || item.text === '') return false;
  if (Object.keys(item.$attrs ?? {}).length > 0) return false;
  return hasOnlyProperties(item, ['text']);
}

/** Documentation entries of plain text as the YAML writes them: one string, or a list of them. */
export function inlineDocumentationEntries(value: any[]): string | string[] | undefined {
  if (!value.every(qualifiesAsInlineEntry)) return undefined;
  return value.length === 1 ? value[0].text : value.map((item) => item.text);
}

export function expandDocumentationEntry(text: string): Record<string, unknown> {
  return { type: DOCUMENTATION_TYPE, text };
}

/* 9. incoming / outgoing: implied by the sequence flows, so only a list that says something else is written */

/** A container's sequence flows by the flow node at each end, in the order the container lists them. */
export type FlowEnds = Map<unknown, { incoming: unknown[]; outgoing: unknown[] }>;

export function flowEndsOf(container: any): FlowEnds {
  const ends: FlowEnds = new Map();
  const at = (node: unknown) => ends.get(node) ?? ends.set(node, { incoming: [], outgoing: [] }).get(node)!;
  for (const item of container?.flowElements ?? []) {
    if (!item?.$instanceOf?.('bpmn:SequenceFlow')) continue;
    if (item.targetRef) at(item.targetRef).incoming.push(item);
    if (item.sourceRef) at(item.sourceRef).outgoing.push(item);
  }
  return ends;
}

/** Whether `refs` is the list `el`'s container's flows imply; `ends` is that container's {@link flowEndsOf}, built once per run. */
export function isImpliedFlowList(el: any, key: 'incoming' | 'outgoing', refs: unknown[], ends: FlowEnds = flowEndsOf(el.$parent)): boolean {
  const implied = ends.get(el)?.[key] ?? [];
  return implied.length === refs.length && implied.every((flow, i) => flow === refs[i]);
}

/* 11. namespace declarations the writer restores on its own */

export function isRedundantNamespaceDeclaration(el: any, name: string): boolean {
  if (el.$type !== 'bpmn:Definitions' || !name.startsWith('xmlns:')) return false;
  const prefix = name.slice('xmlns:'.length);
  if (prefix === 'xsi') return true;
  const packages: any[] = el.$model?.getPackages?.() ?? [];
  // A loaded package's prefix, or another prefix for a loaded package's namespace (bpmn-js's old `bpmn2`): moddle
  // declares what it writes itself.
  const uri = el.$attrs?.[name];
  return packages.some((pkg) => pkg?.prefix === prefix || (typeof uri === 'string' && pkg?.uri === uri));
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
 * The short form of a typed element: its schema type as its own `type`, its wrapper's attributes beside its own
 * (`Survey: {type: cognitive:Questionnaire, instrument: phq-9}`), when the file then still says which is which: the
 * wrapper attaches to the element's type, and no key of it is one the element's type declares or the element holds.
 */
export function foldTypedElement(el: any, out: Record<string, unknown>): Record<string, unknown> {
  const entries = out.extensionElements;
  if (!Array.isArray(entries) || !el?.$model) return out;
  const moddle = el.$model;
  const typed = entries.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    && typeof (entry as any).type === 'string' && attachOf(moddle, (entry as any).type) === el.$type);
  if (typed.length !== 1) return out;
  const entry = typed[0] as Record<string, unknown>;
  const own = declaredKeys(moddle, el.$type);
  const keys = Object.keys(entry).filter((key) => key !== 'type');
  if (keys.some((key) => own.has(key) || key in out || key.includes(':'))) return out;
  const rest = entries.filter((other) => other !== entry);
  const folded: Record<string, unknown> = { type: entry.type };
  for (const [key, value] of Object.entries(out)) {
    if (key === 'type') continue;
    if (key === 'extensionElements') {
      for (const own of keys) folded[own] = entry[own];
      if (rest.length > 0) folded.extensionElements = rest;
      continue;
    }
    folded[key] = value;
  }
  return folded;
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
