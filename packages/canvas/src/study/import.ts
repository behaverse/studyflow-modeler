/**
 * A study model's drawing → {@link Scene}.
 *
 * The layout map is the drawing: a shape or an edge per element it names, one tree of them, each element under the
 * nearest drawn node it sits in. What a further diagram draws (`study.diagram`) is left as the study holds it.
 */

import { DATA_INPUT_ASSOCIATION, DATA_OUTPUT_ASSOCIATION, isDataAssociationType } from '@core/element/index.ts';
import type { Drawing, Element, StudyModel, Value } from '@core/model/index.ts';
import { parseFont } from '@canvas/study/font.ts';
import { idsIn, refOf } from '@canvas/study/elements.ts';
import { mintLabel, syncLabel } from '@canvas/study/labels.ts';
import type {
  Bounds,
  Drawable,
  Point,
  RootElement,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/study/scene.ts';
import { labelHeightFor, nodeLabelBox } from '@canvas/study/text.ts';

export interface ImportOptions {
  onWarning?: (message: string) => void;
}

const PARTICIPANT_TYPE = 'bpmn:Participant';
const LANE_TYPE = 'bpmn:Lane';

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A box as a drawing spells it: `x y w h`, or a mapping of the four. */
export function boxOf(value: Value | undefined): Partial<Bounds> | undefined {
  if (typeof value === 'string') {
    const [x, y, width, height] = value.trim().split(/\s+/).map(Number);
    return { x, y, width, height };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const box = value as Record<string, Value>;
  const number = (key: string): number | undefined => (isFiniteNumber(box[key]) ? box[key] as number : undefined);
  return { x: number('x'), y: number('y'), width: number('width'), height: number('height') };
}

/** A route as a drawing spells it: `x,y x,y`, or a list of points. */
function pointsOf(value: Value | undefined): Point[] {
  if (typeof value === 'string') {
    return value.trim().split(/\s+/).filter(Boolean).map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x: isFiniteNumber(x) ? x : 0, y: isFiniteNumber(y) ? y : 0 };
    });
  }
  return (Array.isArray(value) ? value : []).map((point) => {
    const { x, y } = (point ?? {}) as Record<string, Value>;
    return { x: isFiniteNumber(x) ? x : 0, y: isFiniteNumber(y) ? y : 0 };
  });
}

/** A caption's box as a drawing spells it: `x y w h`, or `{ bounds }`. */
function labelBoxOf(value: Value | undefined): Partial<Bounds> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'bounds' in value) return boxOf((value as Record<string, Value>).bounds);
  return boxOf(value);
}

export function importStudy(model: StudyModel, options: ImportOptions = {}): Scene {
  const warn = options.onWarning ?? ((message: string) => console.warn(`[canvas import] ${message}`));
  const elementsById = new Map<string, SceneElement>();
  const drawn = Object.entries(model.study.layout);

  // Shapes first, so every edge finds its ends.
  const elements: Drawable[] = [];
  const pinned = new Map<Drawable, Partial<Bounds>>();
  for (const shapes of [true, false]) {
    for (const [id, drawing] of drawn) {
      const element = model.get(id);
      if (!element) continue;
      const built = shapes ? ('bounds' in drawing ? buildNode(model, element, drawing, warn) : undefined)
        : ('waypoint' in drawing ? buildEdge(model, element, drawing) : undefined);
      if (!built) continue;
      if (elementsById.has(built.id)) warn(`duplicate element id '${built.id}' — later one wins`);
      elementsById.set(built.id, built);
      elements.push(built);
      const label = labelBoxOf(drawing.label);
      if (label) pinned.set(built, label);
    }
  }
  for (const element of elements) if (element.kind === 'edge') resolveEndpoints(model, element, elementsById);

  const refContainment = collectRefContainment(model, elements);
  const parents = new Map<Drawable, SceneNode | undefined>();
  for (const element of elements) parents.set(element, findParentNode(model, element, elementsById, refContainment));
  resolveLaneMembership(elements, parents);
  const children: SceneElement[] = [];
  for (const element of elements) {
    const parent = parents.get(element);
    element.parent = parent;
    if (parent) parent.children.push(element);
    else children.push(element);
  }

  const root = model.primaryRoot() ?? { type: 'bpmn:Process', id: 'root' };
  const rootElement: RootElement = {
    id: root.id ?? 'root',
    type: model.host(root),
    isRoot: true,
    element: root,
    children,
    parent: undefined,
  };
  const scene: Scene = { model, root, rootElement, children, elementsById, revision: 0 };

  for (const element of elements) attachLabel(scene, element, pinned.get(element));
  return scene;
}

/**
 * What `element` sits in: what holds it, except that a data association is held by its activity, and it sits beside
 * that activity, so a sub-process's own associations stay at its level.
 */
function containerOf(model: StudyModel, element: Element | undefined): Element | undefined {
  const parent = element && model.parentOf(element);
  return element && isDataAssociationType(model.host(element)) ? parent && model.parentOf(parent) : parent;
}

function buildNode(model: StudyModel, element: Element, drawing: Drawing, warn: (m: string) => void): SceneNode {
  const box = boxOf(drawing.bounds);
  if (!box) warn(`the drawing of ${element.id} has no bounds — placed at 0,0`);
  const node: SceneNode = {
    id: element.id!,
    kind: 'node',
    type: model.host(element),
    element,
    x: box?.x ?? 0,
    y: box?.y ?? 0,
    width: box?.width ?? 0,
    height: box?.height ?? 0,
    children: [],
    incoming: [],
    outgoing: [],
  };
  if (typeof drawing.fill === 'string' && drawing.fill) node.fill = drawing.fill;
  if (typeof drawing.stroke === 'string' && drawing.stroke) node.stroke = drawing.stroke;
  const font = parseFont(drawing.font);
  if (font) node.font = font;
  if (typeof drawing.isExpanded === 'boolean') node.isExpanded = drawing.isExpanded;
  if (typeof drawing.isMarkerVisible === 'boolean') node.isMarkerVisible = drawing.isMarkerVisible;
  return node;
}

function buildEdge(model: StudyModel, element: Element, drawing: Drawing): SceneEdge {
  const edge: SceneEdge = {
    id: element.id!,
    kind: 'edge',
    type: model.host(element),
    element,
    waypoints: pointsOf(drawing.waypoint),
  };
  if (typeof drawing.stroke === 'string' && drawing.stroke) edge.stroke = drawing.stroke;
  const font = parseFont(drawing.font);
  if (font) edge.font = font;
  return edge;
}

/** A caption box the drawing gives pins the caption where the document put it. */
function attachLabel(scene: Scene, owner: Drawable, box: Partial<Bounds> | undefined): void {
  const name = owner.element.name;
  if (box && isFiniteNumber(box.x) && isFiniteNumber(box.y) && typeof name === 'string' && name) {
    const width = box.width ?? (owner.kind === 'node' ? nodeLabelBox(owner, name).width : 90);
    const height = box.height ?? labelHeightFor(name, width);
    const label = mintLabel(owner, { x: box.x, y: box.y, width, height }, true);
    scene.elementsById.set(label.id, label);
  }
  syncLabel(scene, owner);
}

/** A data association names only its data end; the activity end is the activity that holds it. */
function resolveEndpoints(model: StudyModel, edge: SceneEdge, drawn: Map<string, SceneElement>): void {
  const nodeOf = (element: Element | undefined): SceneNode | undefined => asNode(element?.id ? drawn.get(element.id) : undefined);
  let source = nodeOf(refOf(model, edge.element, 'sourceRef'));
  let target = nodeOf(refOf(model, edge.element, 'targetRef'));
  if (!source || !target) {
    const owner = nodeOf(model.parentOf(edge.element));
    if (owner && owner !== source && owner !== target) {
      if (edge.type === DATA_INPUT_ASSOCIATION && !target) target = owner;
      else if (edge.type === DATA_OUTPUT_ASSOCIATION && !source) source = owner;
    }
  }
  if (source) {
    edge.source = source;
    if (!source.outgoing.includes(edge)) source.outgoing.push(edge);
  }
  if (target) {
    edge.target = target;
    if (!target.incoming.includes(edge)) target.incoming.push(edge);
  }
}

/**
 * Containment what holds an element does not carry: a pool owns its process's nodes through `processRef`, a lane its
 * members through `flowNodeRef` (deepest lane wins).
 */
function collectRefContainment(model: StudyModel, elements: readonly Drawable[]): Map<Element, Element> {
  const containment = new Map<Element, Element>();
  const claimDepth = new Map<Element, number>();
  for (const { kind, type, element } of elements) {
    if (kind !== 'node') continue;
    if (type === PARTICIPANT_TYPE) {
      const process = refOf(model, element, 'processRef');
      if (process && process !== element) containment.set(process, element);
      continue;
    }
    if (type !== LANE_TYPE) continue;
    const depth = laneNesting(model, element);
    for (const member of idsIn(element.flowNodeRef).map((id) => model.get(id))) {
      if (!member || member === element) continue;
      const claimed = claimDepth.get(member);
      if (claimed !== undefined && claimed >= depth) continue;
      containment.set(member, element);
      claimDepth.set(member, depth);
    }
  }
  return containment;
}

function laneNesting(model: StudyModel, lane: Element): number {
  let depth = 0;
  for (let at = model.parentOf(lane); at; at = model.parentOf(at)) if (model.host(at) === LANE_TYPE) depth += 1;
  return depth;
}

/** The nearest drawn node an element sits in ({@link containerOf}); `undefined` at the top level. */
function findParentNode(
  model: StudyModel,
  drawable: Drawable,
  drawn: Map<string, SceneElement>,
  containment: Map<Element, Element>,
): SceneNode | undefined {
  const up = (element: Element): Element | undefined => containment.get(element) ?? containerOf(model, element);
  const guard = new Set<Element>();
  for (let at = up(drawable.element); at && !guard.has(at); at = up(at)) {
    guard.add(at);
    const node = asNode(at.id ? drawn.get(at.id) : undefined);
    if (node && node !== drawable) return node;
  }
  return undefined;
}

/** A node drawn inside a lane of its container (a pool, or an expanded sub-process) belongs to that lane even without a `flowNodeRef`. */
function resolveLaneMembership(elements: readonly Drawable[], parents: Map<Drawable, SceneNode | undefined>): void {
  const lanes = elements.filter((el): el is SceneNode => el.kind === 'node' && el.type === LANE_TYPE);
  if (lanes.length === 0) return;
  const poolOf = (lane: SceneNode): SceneNode | undefined => {
    let cursor = parents.get(lane);
    const guard = new Set<SceneNode>();
    while (cursor && cursor.type === LANE_TYPE && !guard.has(cursor)) {
      guard.add(cursor);
      cursor = parents.get(cursor);
    }
    return cursor;
  };
  for (const element of elements) {
    if (element.kind !== 'node' || element.type === LANE_TYPE) continue;
    const pool = parents.get(element);
    if (!pool) continue;
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    let best: SceneNode | undefined;
    let bestArea = Infinity;
    for (const lane of lanes) {
      if (poolOf(lane) !== pool) continue;
      if (cx < lane.x || cx > lane.x + lane.width || cy < lane.y || cy > lane.y + lane.height) continue;
      const area = lane.width * lane.height;
      if (area < bestArea) {
        best = lane;
        bestArea = area;
      }
    }
    if (best) parents.set(element, best);
  }
}

function asNode(value: SceneElement | undefined): SceneNode | undefined {
  return value && value.kind === 'node' ? value : undefined;
}
