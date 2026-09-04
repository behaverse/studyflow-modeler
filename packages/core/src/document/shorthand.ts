import * as yaml from 'js-yaml';

import { toLocalName } from '@core/naming';
import { YAML_DUMP_OPTIONS, hasOnlyProperties, valueTypeOf } from '@core/document/format';
import { getProperty, isModdleElement } from '@core/element/moddle';

/* The short forms, in the order a reader meets them; each one is reversible, and the long form is always accepted.
   Specified for authors in docs/reference.qmd, "The file"; pinned by tests/studyflow-yaml.unit.spec.ts. */

/* 1. yaml-body */

type Mapping = Record<string, unknown>;

function asMapping(parsed: unknown): Mapping | undefined {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  return parsed as Mapping;
}

function parseMapping(text: unknown): Mapping | undefined {
  if (typeof text !== 'string' || text === '') return undefined;
  try {
    return asMapping(yaml.load(text));
  } catch {
    return undefined;
  }
}

export function yamlBodyProperty(descriptor: any): any | undefined {
  const body = (descriptor?.properties ?? []).find((p: any) => p.isBody);
  return body && toLocalName(valueTypeOf(body)) === 'YAMLString' ? body : undefined;
}

export function isYamlValueProperty(prop: any): boolean {
  return !prop.isBody && toLocalName(valueTypeOf(prop)) === 'YAMLString';
}

function allKeysDeclared(node: Mapping, descriptor: any): boolean {
  const byName = descriptor?.propertiesByName ?? {};
  return Object.keys(node).every((key) => key in byName);
}

export function qualifiesAsInlineBody(node: Mapping, descriptor: any): boolean {
  const keys = Object.keys(node);
  if (keys.length === 0 || 'type' in node) return false;
  return !allKeysDeclared(node, descriptor);
}

export function qualifiesAsInlineValue(node: Mapping): boolean {
  return !('type' in node);
}

export function inlineYamlBody(el: any): Mapping | undefined {
  const descriptor = el.$descriptor;
  const props: any[] = descriptor?.properties ?? [];
  const body = props.find((p) => p.isBody);
  if (!body || toLocalName(valueTypeOf(body)) !== 'YAMLString') return undefined;
  if (typeof el[body.name] !== 'string' || el[body.name] === '') return undefined;
  if (Object.keys(el.$attrs ?? {}).length > 0) return undefined;
  if (!hasOnlyProperties(el, [body.name])) return undefined;

  const parsed = parseMapping(el[body.name]);
  if (!parsed || !qualifiesAsInlineBody(parsed, descriptor)) return undefined;
  return parsed;
}

export function inlineYamlValue(value: any, prop: any): Mapping | undefined {
  if (!isYamlValueProperty(prop)) return undefined;
  const parsed = parseMapping(value);
  if (!parsed || Object.keys(parsed).length === 0 || !qualifiesAsInlineValue(parsed)) return undefined;
  return parsed;
}

export function expandInlineValue(raw: Mapping): string {
  return yaml.dump(raw, YAML_DUMP_OPTIONS);
}

export function expandInlineBody(node: Mapping): string {
  return yaml.dump(node, YAML_DUMP_OPTIONS);
}

/* 2. element-list */

export function elementListProperty(descriptor: any): any | undefined {
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

/* 4. id-keyed */

export function keyItemsById(items: unknown[]): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const { id, ...body } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || id in out) return undefined;
    out[id] = inlineFlow(item) ?? body;
  }
  return out;
}

export function keyedMapToList(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>).map(([id, body]) => {
    if (body && typeof body === 'object' && !Array.isArray(body)) return { id, ...(body as object) };
    return typeof body === 'string' ? { id, [INLINE_BODY]: body } : { id };
  });
}

/* 5. expression-body */

const BPMN_EXPRESSION = 'bpmn:Expression';
const BPMN_FORMAL_EXPRESSION = 'bpmn:FormalExpression';

/** The instantiation marker the parser records on an `xsi:type`d element, not content. */
const XSI_TYPE = 'xsi:type';

export function isExpressionType(typeName: string | undefined): boolean {
  return typeName === BPMN_FORMAL_EXPRESSION || typeName === BPMN_EXPRESSION;
}

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


/** One name in three places: the moddle attribute marking the entry, the YAML key it folds to, and the attribute `StudyflowElement` routes. */
export const CHECKLIST_MARKER = 'checklist';

export function isChecklistEntry(item: any): boolean {
  return isModdleElement(item) && getProperty(item, CHECKLIST_MARKER) === true;
}

/** {@link isChecklistEntry} for raw XML attribute text; the gallery probes the DOM, not moddle. */
export function isChecklistMarkerValue(value: string | null | undefined): boolean {
  return value === 'true' || value === '1';
}

export function isDocumentationType(typeName: string | undefined): boolean {
  return typeName === DOCUMENTATION_TYPE;
}

export function isDocumentationProperty(prop: any): boolean {
  return isDocumentationType(prop?.type);
}

function qualifiesAsInlineEntry(item: any, marked: boolean): boolean {
  if (!isModdleElement(item) || item.$type !== DOCUMENTATION_TYPE) return false;
  if (typeof item.text !== 'string' || item.text === '') return false;
  if (Object.keys(item.$attrs ?? {}).length > 0) return false;
  return hasOnlyProperties(item, marked ? ['text', CHECKLIST_MARKER] : ['text']);
}

export function inlineDocumentationEntries(
  value: any[],
): { documentation?: string | string[]; checklist?: string } | undefined {
  const prose: string[] = [];
  let checklist: string | undefined;
  for (const item of value) {
    const marked = isChecklistEntry(item);
    if (!qualifiesAsInlineEntry(item, marked)) return undefined;
    if (!marked) {
      prose.push(item.text);
      continue;
    }
    if (checklist !== undefined) return undefined;
    checklist = item.text;
  }
  return {
    documentation: prose.length === 0 ? undefined : prose.length === 1 ? prose[0] : prose,
    checklist,
  };
}

export function expandDocumentationEntry(text: string): Record<string, unknown> {
  return { type: DOCUMENTATION_TYPE, text };
}

export function expandChecklistEntry(text: string): Record<string, unknown> {
  return { type: DOCUMENTATION_TYPE, [CHECKLIST_MARKER]: true, text };
}

/* 7. type names: BPMN is the default namespace, so `bpmn:StartEvent` is spelled `StartEvent` */

const BPMN_PREFIX = 'bpmn:';

export function shortTypeName(qname: string): string {
  return qname.startsWith(BPMN_PREFIX) ? qname.slice(BPMN_PREFIX.length) : qname;
}

/** A prefixed name is kept; a bare one is BPMN (a lower-case first letter is tolerated). */
export function longTypeName(name: string): string {
  if (name.includes(':')) return name;
  return `${BPMN_PREFIX}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/* 8. geometry and colour on a DI node: `bounds: x y width height`, `waypoint: x,y x,y`, `fill` / `stroke` */

export const DI_NODE_TYPES = new Set(['bpmndi:BPMNShape', 'bpmndi:BPMNEdge']);

type Box = { x: number; y: number; width: number; height: number };

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function boxToText(box: unknown): string | undefined {
  if (!box || typeof box !== 'object' || Array.isArray(box)) return undefined;
  const { x, y, width, height, ...rest } = box as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || ![x, y, width, height].every(isFiniteNumber)) return undefined;
  return `${x} ${y} ${width} ${height}`;
}

function textToBox(text: string): Box | undefined {
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return undefined;
  const [x, y, width, height] = parts;
  return { x, y, width, height };
}

function pointsToText(points: unknown): string | undefined {
  if (!Array.isArray(points) || points.length === 0) return undefined;
  const pairs: string[] = [];
  for (const point of points) {
    if (!point || typeof point !== 'object') return undefined;
    const { x, y, ...rest } = point as Record<string, unknown>;
    if (Object.keys(rest).length > 0 || !isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;
    pairs.push(`${x},${y}`);
  }
  return pairs.join(' ');
}

function textToPoints(text: string): { x: number; y: number }[] | undefined {
  const points = text.trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
  if (points.some((point) => point.length !== 2 || !point.every(Number.isFinite))) return undefined;
  return points.map(([x, y]) => ({ x, y }));
}

/** Each colour role's DI property names by local name: the `color` vocabulary first, the `bioc` one second. */
const COLOR_KEYS = {
  fill: ['background-color', 'fill'],
  stroke: ['border-color', 'stroke'],
} as const;

/** Rewrite a serialized DI node in place: geometry on one line, one key per colour. */
export function compactDiNode(node: Record<string, unknown>): void {
  const bounds = boxToText(node.bounds);
  if (bounds !== undefined) node.bounds = bounds;
  const waypoint = pointsToText(node.waypoint);
  if (waypoint !== undefined) node.waypoint = waypoint;
  const label = node.label;
  if (label && typeof label === 'object' && !Array.isArray(label)) {
    const { bounds: labelBounds, ...rest } = label as Record<string, unknown>;
    const text = Object.keys(rest).length === 0 ? boxToText(labelBounds) : undefined;
    if (text !== undefined) node.label = text;
  }
  for (const role of ['fill', 'stroke'] as const) {
    const [colorKey, biocKey] = COLOR_KEYS[role];
    const value = node[colorKey] ?? node[biocKey];
    delete node[colorKey];
    delete node[biocKey];
    if (value !== undefined) node[role] = value;
  }
}

/** The inverse, on the raw keys of a DI node: strings back to mappings, one colour into both vocabularies. */
export function expandDiNode(props: Record<string, unknown>): void {
  if (typeof props.bounds === 'string') {
    const box = textToBox(props.bounds);
    if (box) props.bounds = box;
  }
  if (typeof props.waypoint === 'string') {
    const points = textToPoints(props.waypoint);
    if (points) props.waypoint = points;
  }
  if (typeof props.label === 'string') {
    const box = textToBox(props.label);
    if (box) props.label = { bounds: box };
  }
  for (const role of ['fill', 'stroke'] as const) {
    const value = props[role];
    if (value === undefined) continue;
    delete props[role];
    for (const key of COLOR_KEYS[role]) props[key] = value;
  }
}

/* 9. incoming / outgoing: implied by the sequence flows, so only a list that says something else is written */

export function isImpliedFlowList(el: any, key: 'incoming' | 'outgoing', refs: unknown[]): boolean {
  const end = key === 'incoming' ? 'targetRef' : 'sourceRef';
  const siblings: any[] = el.$parent?.flowElements ?? [];
  const implied = siblings.filter((item) => item?.$instanceOf?.('bpmn:SequenceFlow') && item[end] === el);
  return implied.length === refs.length && implied.every((flow, i) => flow === refs[i]);
}

/* 10. a bare flow of any kind: `Flow_1: A -> B` (what kind it is, its place in the file already says) */

const ARROW = /^\s*(\S+)\s*->\s*(\S+)\s*$/;

/** The key a keyed list item carries its string body under, until {@link expandInlineFlow} reads it. */
export const INLINE_BODY = '$inline';

export function inlineFlow(item: unknown): string | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const { id, sourceRef, targetRef, ...rest } = item as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof id !== 'string' || typeof targetRef !== 'string') return undefined;
  // A data association lists its sources; one source still reads as an arrow.
  const source = Array.isArray(sourceRef) && sourceRef.length === 1 ? sourceRef[0] : sourceRef;
  return typeof source === 'string' ? `${source} -> ${targetRef}` : undefined;
}

export function expandInlineFlow(item: unknown): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const { [INLINE_BODY]: body, ...rest } = item as Record<string, unknown>;
  if (typeof body !== 'string') return item;
  const arrow = ARROW.exec(body);
  if (!arrow) throw new Error(`'${rest.id}: ${body}' is not a flow; write 'source -> target' or a mapping`);
  return { ...rest, sourceRef: arrow[1], targetRef: arrow[2] };
}

/* 11. namespace declarations the writer restores on its own */

export function isRedundantNamespaceDeclaration(el: any, name: string): boolean {
  if (el.$type !== 'bpmn:Definitions' || !name.startsWith('xmlns:')) return false;
  const prefix = name.slice('xmlns:'.length);
  if (prefix === 'xsi') return true;
  const packages: any[] = el.$model?.getPackages?.() ?? [];
  return packages.some((pkg) => pkg?.prefix === prefix);
}

/* 12. types the container and the keys already imply */

/** Under an abstract list type, these keys settle the concrete type, so `type:` is not written. */
const IMPLIED_TYPES: Record<string, ReadonlyArray<readonly [readonly string[], string]>> = {
  'bpmn:FlowElement': [[['sourceRef', 'targetRef'], 'bpmn:SequenceFlow']],
  'bpmn:Artifact': [[['sourceRef', 'targetRef'], 'bpmn:Association'], [['text'], 'bpmn:TextAnnotation']],
};

export function impliedTypeName(node: Record<string, unknown>, declaredType: string | undefined): string | undefined {
  for (const [keys, type] of IMPLIED_TYPES[declaredType ?? ''] ?? []) {
    if (keys.every((key) => key in node)) return type;
  }
  return undefined;
}
