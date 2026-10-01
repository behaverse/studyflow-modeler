/**
 * The short forms of the `.studyflow.yaml` file, on plain data: each reversible, the long form always accepted.
 * Specified for authors in docs/reference.qmd, "The file"; pinned by packages/core/tests/studyflow-yaml.unit.spec.ts.
 */
import * as yaml from 'js-yaml';

import { toLocalName } from '@core/naming';

export const YAML_DUMP_OPTIONS: yaml.DumpOptions = { noRefs: true, lineWidth: 120, quotingType: '"' };

function valueTypeOf(prop: any): string | undefined {
  return prop.valueType ?? prop.type;
}

/* yaml-value: a YAML-typed attribute written as its mapping */

type Mapping = Record<string, unknown>;

function asMapping(parsed: unknown): Mapping | undefined {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  return parsed as Mapping;
}

/**
 * `text` as a mapping, unless it may carry a comment: the mapping keeps the data but not the comments, so
 * such text keeps its long form. A ` #` inside a quoted value also counts, which costs only the fold.
 */
function parseMapping(text: unknown): Mapping | undefined {
  if (typeof text !== 'string' || text === '' || /(^|\s)#/.test(text)) return undefined;
  try {
    return asMapping(yaml.load(text));
  } catch {
    return undefined;
  }
}

export function isYamlValueProperty(prop: any): boolean {
  return !prop.isBody && toLocalName(valueTypeOf(prop)) === 'YAMLString';
}

export function qualifiesAsInlineValue(node: Mapping): boolean {
  return !('type' in node);
}

export function inlineYamlValue(value: any, prop: any): Mapping | undefined {
  if (!isYamlValueProperty(prop)) return undefined;
  const parsed = parseMapping(value);
  if (!parsed || Object.keys(parsed).length === 0 || !qualifiesAsInlineValue(parsed)) return undefined;
  return parsed;
}

/** A folded mapping back to the YAML text the attribute stores. */
export function expandInline(mapping: Mapping): string {
  return yaml.dump(mapping, YAML_DUMP_OPTIONS);
}

/** The caption's look, studyflow's `Font` trait on the shape or edge (`@canvas/model/font.ts` spells its value), read and written as `font`. */
const FONT_ATTRIBUTE = 'studyflow:font';
const FONT_KEY = 'font';

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

const BPMN_EXPRESSION = 'bpmn:Expression';
export const BPMN_FORMAL_EXPRESSION = 'bpmn:FormalExpression';

export function isExpressionType(typeName: string | undefined): boolean {
  return typeName === BPMN_FORMAL_EXPRESSION || typeName === BPMN_EXPRESSION;
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

/* 8. geometry, colour and font on a DI node: `bounds: x y width height`, `waypoint: x,y x,y`, `fill` / `stroke`, `font` */

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
  if (node[FONT_ATTRIBUTE] !== undefined) {
    node[FONT_KEY] = node[FONT_ATTRIBUTE];
    delete node[FONT_ATTRIBUTE];
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
  if (props[FONT_KEY] !== undefined) {
    props[FONT_ATTRIBUTE] = props[FONT_KEY];
    delete props[FONT_KEY];
  }
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
