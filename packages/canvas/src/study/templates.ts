/**
 * A template, dropped: its elements built as a file holding them builds, an id the study already holds moved
 * aside (and code that names it following), then laid out inside the shape the template drops as.
 */

import { PLACEHOLDER } from '@core/document/index.ts';
import { StudyModel, isElement, type Element, type Value } from '@core/model/index.ts';
import { renameIds } from '@core/model/root.ts';
import { readStudy } from '@core/model/yaml.ts';
import { getCatalog, hasCatalog, type Template } from '@core/notation/index.ts';

import { idsIn, listOf, refOf } from '@canvas/study/elements.ts';
import type { IdGenerator } from '@canvas/study/ids.ts';
import { boxOf } from '@canvas/study/import.ts';
import type { Mutator } from '@canvas/study/mutator.ts';
import { routableEnd, routeFor } from '@canvas/study/orthogonal.ts';
import { defaultSizeFor, type NewElement, type NewShape } from '@canvas/study/prototype.ts';
import type { Rules } from '@canvas/study/rules.ts';
import type { Bounds, Point, SceneNode } from '@canvas/study/scene.ts';

/** A template's elements, and where its drawing puts them, ready to lay out inside the shape it drops as. */
export interface TemplateBuild {
  /** The element the template drops as, its flow taken out to be laid out. */
  root: Element;
  nodes: { element: Element; bounds: Bounds }[];
  flows: { element: Element; waypoints?: Point[] }[];
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

/** `template`'s elements, built for `model`: an id `model` holds is suffixed from `ids`, and code naming it follows. */
export function buildTemplate(template: Template, model: StudyModel, ids: Pick<IdGenerator, 'nextPrefixed'>): TemplateBuild {
  const fragment = new StudyModel(readStudy(structuredClone({ definitions: {}, elements: template.elements }) as never, model.metamodel, () => {}), model.metamodel);
  renameClashes(fragment, model, ids);
  const root = fragment.study.roots[0];
  const isPool = fragment.host(root) === 'bpmn:Participant';
  const holder = isPool ? refOf(fragment, root, 'processRef') : root;
  const children = listOf(holder, 'flowElements');
  // The layout files each element as it places it; a pool takes its process from the layout, only its flow from the template.
  if (isPool) delete root.processRef;
  else if (children.length > 0) root.flowElements = [];
  for (const child of children) fragment.unfile(child);

  const isFlow = (element: Element): boolean => fragment.isA(element, 'bpmn:SequenceFlow');
  const { layout } = fragment.study;
  const boundsOf = (element: Element): Bounds => {
    const box = element.id ? boxOf(layout[element.id]?.bounds) : undefined;
    return box?.x !== undefined ? { x: box.x, y: box.y ?? 0, width: box.width ?? 0, height: box.height ?? 0 } : { x: 0, y: 0, ...defaultSizeFor(fragment.host(element)) };
  };
  const routeOf = (element: Element): Point[] | undefined => {
    const text = element.id ? layout[element.id]?.waypoint : undefined;
    if (typeof text !== 'string' || !text.trim()) return undefined;
    return text.trim().split(/\s+/).map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });
  };

  return {
    root,
    nodes: children.filter((element) => !isFlow(element)).map((element) => ({ element, bounds: boundsOf(element) })),
    flows: children.filter(isFlow).map((element) => ({ element, waypoints: routeOf(element) })),
  };
}

/** Lay `build` out inside `container`, the shape its template dropped as: its nodes where it draws them, then its flows. */
export function layOutTemplate(mutator: Mutator, rules: Rules, container: SceneNode, build: TemplateBuild, host: (element: Element) => string): void {
  const shift = fitParticipant(mutator, container, build.nodes.map((node) => node.bounds));

  const placed = new Map<string, SceneNode>();
  for (const { element, bounds } of build.nodes) {
    const at = { ...bounds, x: bounds.x + shift.x, y: bounds.y + shift.y };
    placed.set(element.id!, mutator.addShape({ type: host(element), element, bounds: at, parent: container }));
  }

  for (const { element: flow, waypoints } of build.flows) {
    const source = placed.get(idsIn(flow.sourceRef)[0] ?? '');
    const target = placed.get(idsIn(flow.targetRef)[0] ?? '');
    const spec = source && target ? rules.canConnect(source, target) : false;
    if (!source || !target || !spec) {
      console.warn(`[templates] Skipping connection '${flow.id}' - source or target not found.`);
      continue;
    }
    mutator.addConnection({
      type: spec.type,
      source,
      target,
      element: flow,
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

/** Renamed ids where code names them: every word of an expression, and the name in each `{placeholder}`. */
function renameInCode(model: StudyModel, element: Element, renamed: Map<string, string>): void {
  const inPlaceholders = (text: string): string => text.replace(PLACEHOLDER, (match, path: string) => {
    const head = path.split('.')[0];
    return renamed.has(head) ? match.replace(head, renamed.get(head)!) : match;
  });
  const inExpression = (text: string): string => text.replace(/[\p{L}\p{N}_-]+/gu, (word) => renamed.get(word) ?? word);
  for (const [key, value] of Object.entries(element)) {
    if (key === 'type' || key === 'id' || value === undefined) continue;
    const property = model.propertyAt(element, key);
    if (property?.isReference) continue;
    const expression = !!property && model.metamodel.has(property.type) && model.metamodel.isA(property.type, 'bpmn:Expression');
    if (typeof value === 'string') element[key] = expression ? inExpression(value) : inPlaceholders(value);
    else if (isElement(value) && expression && typeof value.body === 'string') value.body = inExpression(value.body);
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) element[key] = (value as string[]).map(inPlaceholders) as Value[];
  }
}

/**
 * An id of `fragment` that `held` already holds is suffixed (a second drop gets `eo_gate_…`): references follow the
 * element they point at, and so does code that names it by text, an expression (`state._meta.reached.eo_gate`) or a
 * `{placeholder}`. Names and documentation keep the word.
 */
export function renameClashes(fragment: StudyModel, held: StudyModel, ids: Pick<IdGenerator, 'nextPrefixed'>): void {
  const renamed = new Map<string, string>();
  for (const element of fragment.all()) {
    if (typeof element.id !== 'string' || !held.get(element.id)) continue;
    renamed.set(element.id, ids.nextPrefixed(`${element.id}_`));
  }
  if (renamed.size === 0) return;
  renameIds(fragment, renamed);
  for (const element of fragment.all()) renameInCode(fragment, element, renamed);
}
