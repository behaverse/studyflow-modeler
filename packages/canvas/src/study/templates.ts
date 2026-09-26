/**
 * A template, dropped: its elements built as a file holding them builds, an id the document already holds moved
 * aside (and code that names it following), then laid out inside the shape the template drops as.
 */

import { PLACEHOLDER, studyflowToDefinitions } from '@core/document/index.ts';
import { getCatalog, hasCatalog, type Template } from '@core/notation/index.ts';

import type { IdGenerator } from '@canvas/study/ids.ts';
import { modelOf, prop } from '@canvas/study/moddle.ts';
import type { Mutator } from '@canvas/study/mutator.ts';
import { routableEnd, routeFor } from '@canvas/study/orthogonal.ts';
import { defaultSizeFor, type NewElement, type NewShape } from '@canvas/study/prototype.ts';
import type { Rules } from '@canvas/study/rules.ts';
import type { Bounds, ModdleObject, Point, SceneNode } from '@canvas/study/scene.ts';

/** A moddle element as the template walk reads it: its descriptor names its properties. */
type Described = ModdleObject & {
  $descriptor: { properties: { name: string; isReference?: boolean }[] };
  $instanceOf(type: string): boolean;
  $attrs?: Record<string, unknown>;
  set(name: string, value: unknown): void;
};

/** A template's elements, and where its drawing puts them, ready to lay out inside the shape it drops as. */
export interface TemplateBuild {
  /** The element the template drops as, its flow taken out to be laid out. */
  root: ModdleObject;
  nodes: { businessObject: ModdleObject; bounds: Bounds }[];
  flows: { businessObject: ModdleObject; waypoints?: Point[] }[];
}

/** Left covers the pool's label band. */
const POOL_PADDING = { left: 70, right: 40 };

/** The template the catalog lists under `id`. */
export function findTemplate(id: string): Template | undefined {
  return hasCatalog() ? getCatalog().allTemplates().find((template) => template.id === id) : undefined;
}

/** The shape `what` drops as: itself, or its template's; nothing when the catalog lists no such template. */
export function shapeOf(what: NewElement): NewShape | undefined {
  if (!('template' in what)) return what;
  const template = findTemplate(what.template);
  return template && { type: template.bpmnType, ...(template.extensionType ? { extension: template.extensionType } : {}) };
}

/** `template`'s elements, built for `document`: an id `document` holds is suffixed from `ids`, and code naming it follows. */
export function buildTemplate(template: Template, document: ModdleObject, ids: Pick<IdGenerator, 'nextPrefixed'>): TemplateBuild {
  const definitions = buildElements(template.elements, document, ids);
  const root = (prop(definitions, 'rootElements') as Described[])[0];
  const isPool = root.$type === 'bpmn:Participant';
  const children = (prop(isPool ? prop(root, 'processRef') as ModdleObject : root, 'flowElements') ?? []) as Described[];
  // The layout files each element as it places it; a pool takes its process from the layout, only its flow from the template.
  if (isPool) root.set('processRef', undefined);
  else if (children.length > 0) root.set('flowElements', []);

  const bounds = new Map<ModdleObject, Bounds>();
  const routes = new Map<ModdleObject, Point[]>();
  const diagram = (prop(definitions, 'diagrams') as ModdleObject[] | undefined)?.[0];
  for (const di of (prop(prop(diagram, 'plane') as ModdleObject | undefined, 'planeElement') ?? []) as ModdleObject[]) {
    const element = prop(di, 'bpmnElement') as ModdleObject;
    const box = prop(di, 'bounds') as Bounds | undefined;
    const waypoints = prop(di, 'waypoint') as Point[] | undefined;
    if (box) bounds.set(element, { x: box.x, y: box.y, width: box.width, height: box.height });
    if (waypoints?.length) routes.set(element, waypoints.map(({ x, y }) => ({ x, y })));
  }
  const isFlow = (bo: Described): boolean => bo.$instanceOf('bpmn:SequenceFlow');

  return {
    root,
    nodes: children.filter((bo) => !isFlow(bo)).map((bo) => ({
      businessObject: bo,
      bounds: bounds.get(bo) ?? { x: 0, y: 0, ...defaultSizeFor(bo.$type) },
    })),
    flows: children.filter(isFlow).map((bo) => ({ businessObject: bo, waypoints: routes.get(bo) })),
  };
}

/** Lay `build` out inside `container`, the shape its template dropped as: its nodes where it draws them, then its flows. */
export function layOutTemplate(mutator: Mutator, rules: Rules, container: SceneNode, build: TemplateBuild): void {
  const shift = fitParticipant(mutator, container, build.nodes.map((node) => node.bounds));

  const placed = new Map<unknown, SceneNode>();
  for (const { businessObject, bounds } of build.nodes) {
    const at = { ...bounds, x: bounds.x + shift.x, y: bounds.y + shift.y };
    placed.set(businessObject, mutator.addShape({ type: businessObject.$type, businessObject, bounds: at, parent: container }));
  }

  for (const { businessObject: flow, waypoints } of build.flows) {
    const source = placed.get(prop(flow, 'sourceRef'));
    const target = placed.get(prop(flow, 'targetRef'));
    const spec = source && target ? rules.canConnect(source, target) : false;
    if (!source || !target || !spec) {
      console.warn(`[templates] Skipping connection '${flow.id}' - source or target not found.`);
      continue;
    }
    mutator.addConnection({
      type: spec.type,
      source,
      target,
      businessObject: flow,
      waypoints: waypoints?.map(({ x, y }) => ({ x: x + shift.x, y: y + shift.y })) ?? routeFor(spec.type, routableEnd(source), target),
    });
  }
}

/** Participants hold their flow inline (no drilldown), so grow the pool around the template's bounding box; returns the shift that moves the nodes into it. */
function fitParticipant(mutator: Mutator, pool: SceneNode, boxes: Bounds[]): { x: number; y: number } {
  if (pool.type !== 'bpmn:Participant' || boxes.length === 0) return { x: 0, y: 0 };

  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const bboxWidth = Math.max(...boxes.map((box) => box.x + box.width)) - minX;
  const bboxHeight = Math.max(...boxes.map((box) => box.y + box.height)) - minY;

  const width = Math.max(pool.width, bboxWidth + POOL_PADDING.left + POOL_PADDING.right);
  const height = Math.max(pool.height, bboxHeight + 80);
  mutator.setNodeBounds(pool, { x: pool.x, y: pool.y, width, height });

  return {
    x: pool.x + POOL_PADDING.left - minX,
    y: pool.y + Math.round((height - bboxHeight) / 2) - minY,
  };
}

/** Every moddle element in a subtree; references are not followed. */
function* elementsIn(value: unknown): Generator<Described> {
  if (Array.isArray(value)) {
    for (const item of value) yield* elementsIn(item);
  } else if ((value as Described | undefined)?.$descriptor) {
    const element = value as Described;
    yield element;
    for (const property of element.$descriptor.properties) {
      if (!property.isReference) yield* elementsIn((element as Record<string, unknown>)[property.name]);
    }
  }
}

/** Renamed ids where code names them: every word of an expression's body, and the name in each `{placeholder}`. */
function renameInCode(element: Described, renamed: Map<string, string>): void {
  const inPlaceholders = (text: string): string => text.replace(PLACEHOLDER, (match, path: string) => {
    const head = path.split('.')[0];
    return renamed.has(head) ? match.replace(head, renamed.get(head)!) : match;
  });
  const isExpression = element.$instanceOf('bpmn:Expression');
  for (const property of element.$descriptor.properties) {
    const value = (element as Record<string, unknown>)[property.name];
    if (property.isReference || property.name === 'id') continue;
    if (isExpression && property.name === 'body' && typeof value === 'string') {
      element.set('body', value.replace(/[\p{L}\p{N}_-]+/gu, (word) => renamed.get(word) ?? word));
    } else if (typeof value === 'string') {
      element.set(property.name, inPlaceholders(value));
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      element.set(property.name, value.map(inPlaceholders));
    }
  }
  for (const [name, value] of Object.entries(element.$attrs ?? {})) {
    if (typeof value === 'string') element.$attrs![name] = inPlaceholders(value);
  }
}

/**
 * The template's elements, built as a file holding them builds. An id `document` already holds is suffixed (a
 * second drop gets `eo_gate_…`): references follow the element they point at, and so does code that names it by
 * text, an expression (`state.trace.count('eo_gate')`) or a `{placeholder}`. Names and documentation keep the word.
 */
function buildElements(elements: Record<string, unknown>, document: ModdleObject, ids: Pick<IdGenerator, 'nextPrefixed'>): ModdleObject {
  const definitions = studyflowToDefinitions({ definitions: {}, elements }, modelOf(document) as never) as ModdleObject;
  const held = new Set([...elementsIn(document)].map((element) => element.id));
  const renamed = new Map<string, string>();
  for (const element of elementsIn(prop(definitions, 'rootElements'))) {
    if (typeof element.id !== 'string' || !held.has(element.id)) continue;
    const id = ids.nextPrefixed(`${element.id}_`);
    renamed.set(element.id, id);
    element.id = id;
  }
  if (renamed.size > 0) for (const element of elementsIn(prop(definitions, 'rootElements'))) renameInCode(element, renamed);
  return definitions;
}
