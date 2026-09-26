/**
 * `bpmn:Definitions` (with DI) → {@link Scene}.
 *
 * The first diagram's plane is the drawing: its shapes and edges form one tree, each
 * element under the nearest drawn node its business object sits in. What only a
 * further plane draws (another tool's collapsed sub-process) is left out, with a
 * warning; the canvas writes one plane back (`model/di.ts`).
 */

import { readColorsOf } from '@canvas/model/color.ts';
import { DATA_INPUT_ASSOCIATION, DATA_OUTPUT_ASSOCIATION, isDataAssociationType } from '@canvas/model/dataAssociation.ts';
import { FONT_PROPERTY, parseFont } from '@canvas/model/font.ts';
import { mintLabel, syncLabel } from '@canvas/model/labels.ts';
import { asList, asModdle, parentOf, prop, refBO } from '@canvas/model/moddle.ts';
import { isExpandable } from '@canvas/model/tree.ts';
import type {
  Drawable,
  ModdleObject,
  Point,
  RootElement,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';
import { labelHeightFor, nodeLabelBox } from '@canvas/render/labels.ts';

export interface ImportOptions {
  onWarning?: (message: string) => void;
  /** Leave out whatever sits inside a sub-process (any expandable container), collapsed or expanded. */
  mainCanvasOnly?: boolean;
}

const SHAPE_TYPE = 'bpmndi:BPMNShape';
const EDGE_TYPE = 'bpmndi:BPMNEdge';
const PARTICIPANT_TYPE = 'bpmn:Participant';
const LANE_TYPE = 'bpmn:Lane';

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function idOf(target: ModdleObject | undefined): string | undefined {
  const id = prop(target, 'id');
  return typeof id === 'string' && id ? id : undefined;
}

export function importDefinitions(definitions: ModdleObject, options: ImportOptions = {}): Scene {
  const warn = options.onWarning ?? ((message: string) => console.warn(`[canvas import] ${message}`));
  const elementsById = new Map<string, SceneElement>();
  const byBusinessObject = new Map<ModdleObject, Drawable>();
  const plane = drawnPlane(definitions, warn);
  const drawn = asList(prop(plane, 'planeElement'))
    .filter((di) => !options.mainCanvasOnly || !insideSubProcess(asModdle(prop(di, 'bpmnElement'))));

  const index = (element: Drawable): void => {
    if (element.id) {
      if (elementsById.has(element.id)) warn(`duplicate element id '${element.id}' — later one wins`);
      elementsById.set(element.id, element);
    }
    byBusinessObject.set(element.businessObject, element);
  };

  // Shapes first, so every edge finds its ends.
  const elements: Drawable[] = [];
  for (const shape of drawn.filter((di) => di.$type === SHAPE_TYPE)) {
    const node = buildNode(shape, warn);
    if (node) elements.push(node);
  }
  for (const di of drawn.filter((el) => el.$type === EDGE_TYPE)) {
    const edge = buildEdge(di, warn);
    if (edge) elements.push(edge);
  }
  for (const element of elements) index(element);
  for (const element of elements) if (element.kind === 'edge') resolveEndpoints(element, byBusinessObject);

  const refContainment = collectRefContainment(byBusinessObject);
  const parents = new Map<Drawable, SceneNode | undefined>();
  for (const element of elements) parents.set(element, findParentNode(element, byBusinessObject, refContainment));
  resolveLaneMembership(elements, parents);
  const children: SceneElement[] = [];
  for (const element of elements) {
    const parent = parents.get(element);
    element.parent = parent;
    if (parent) parent.children.push(element);
    else children.push(element);
  }

  const root = asModdle(prop(plane, 'bpmnElement')) ?? asList(prop(definitions, 'rootElements'))[0] ?? definitions;
  const rootElement: RootElement = {
    id: idOf(root) ?? 'root',
    type: root.$type,
    isRoot: true,
    businessObject: root,
    children,
    parent: undefined,
  };
  const scene: Scene = {
    definitions,
    root,
    rootElement,
    children,
    elementsById,
    byBusinessObject,
    revision: 0,
  };

  for (const element of byBusinessObject.values()) attachLabel(scene, element);
  return scene;
}

/** The first diagram's plane. A further diagram is not drawn, and a warning names it. */
function drawnPlane(definitions: ModdleObject, warn: (m: string) => void): ModdleObject | undefined {
  const [first, ...others] = asList(prop(definitions, 'diagrams'));
  for (const diagram of others) {
    const count = asList(prop(asModdle(prop(diagram, 'plane')), 'planeElement')).length;
    if (count > 0) warn(`diagram ${idOf(diagram) ?? '<no id>'} is not drawn: the canvas draws the first plane only, so its ${count} shapes and edges are dropped`);
  }
  return asModdle(prop(first, 'plane'));
}

/**
 * What `businessObject` sits in: its `$parent`, except that a data association's `$parent` is its
 * activity, and it sits beside that activity, so a sub-process's own associations stay at its level.
 */
function containerOf(businessObject: ModdleObject | undefined): ModdleObject | undefined {
  const parent = parentOf(businessObject);
  return businessObject && isDataAssociationType(businessObject.$type) ? parentOf(parent) : parent;
}

/** Whether `businessObject` sits inside a sub-process, however deep. */
// ponytail: a message flow into a sub-process's contents keeps its line and loses its end; drop it too if one shows.
function insideSubProcess(businessObject: ModdleObject | undefined): boolean {
  for (let p = containerOf(businessObject); p; p = parentOf(p)) {
    if (isExpandable(p.$type)) return true;
  }
  return false;
}

function buildNode(shape: ModdleObject, warn: (m: string) => void): SceneNode | undefined {
  const businessObject = asModdle(prop(shape, 'bpmnElement'));
  if (!businessObject) {
    warn(`BPMNShape ${idOf(shape) ?? '<no id>'} has no bpmnElement — skipped`);
    return undefined;
  }
  const bounds = asModdle(prop(shape, 'bounds'));
  if (!bounds) warn(`BPMNShape for ${idOf(businessObject) ?? '<no id>'} has no dc:Bounds — placed at 0,0`);
  const node: SceneNode = {
    id: idOf(businessObject) ?? idOf(shape) ?? '',
    kind: 'node',
    type: businessObject.$type,
    businessObject,
    x: num(prop(bounds, 'x')) ?? 0,
    y: num(prop(bounds, 'y')) ?? 0,
    width: num(prop(bounds, 'width')) ?? 0,
    height: num(prop(bounds, 'height')) ?? 0,
    children: [],
    incoming: [],
    outgoing: [],
    ...readColorsOf(shape),
  };
  const font = parseFont(prop(shape, FONT_PROPERTY));
  if (font) node.font = font;
  const isExpanded = prop(shape, 'isExpanded');
  if (typeof isExpanded === 'boolean') node.isExpanded = isExpanded;
  const isMarkerVisible = prop(shape, 'isMarkerVisible');
  if (typeof isMarkerVisible === 'boolean') node.isMarkerVisible = isMarkerVisible;
  (node as { di?: ModdleObject }).di = shape;
  return node;
}

function buildEdge(di: ModdleObject, warn: (m: string) => void): SceneEdge | undefined {
  const businessObject = asModdle(prop(di, 'bpmnElement'));
  if (!businessObject) {
    warn(`BPMNEdge ${idOf(di) ?? '<no id>'} has no bpmnElement — skipped`);
    return undefined;
  }
  const waypoints: Point[] = asList(prop(di, 'waypoint')).map((wp) => ({
    x: num(prop(wp, 'x')) ?? 0,
    y: num(prop(wp, 'y')) ?? 0,
  }));
  const edge: SceneEdge = {
    id: idOf(businessObject) ?? idOf(di) ?? '',
    kind: 'edge',
    type: businessObject.$type,
    businessObject,
    waypoints,
  };
  const { stroke } = readColorsOf(di);
  if (stroke) edge.stroke = stroke;
  const font = parseFont(prop(di, FONT_PROPERTY));
  if (font) edge.font = font;
  (edge as { di?: ModdleObject }).di = di;
  return edge;
}

/** A `bpmndi:BPMNLabel` with bounds pins the caption where the document put it. */
function attachLabel(scene: Scene, owner: Drawable): void {
  const di = (owner as { di?: ModdleObject }).di;
  delete (owner as { di?: ModdleObject }).di;
  const bounds = asModdle(prop(asModdle(prop(di, 'label')), 'bounds'));
  const x = num(prop(bounds, 'x'));
  const y = num(prop(bounds, 'y'));
  const name = prop(owner.businessObject, 'name');
  if (x !== undefined && y !== undefined && typeof name === 'string' && name) {
    const width = num(prop(bounds, 'width'))
      ?? (owner.kind === 'node' ? nodeLabelBox(owner, name).width : 90);
    const height = num(prop(bounds, 'height')) ?? labelHeightFor(name, width);
    const label = mintLabel(owner, { x, y, width, height }, true);
    scene.elementsById.set(label.id, label);
  }
  syncLabel(scene, owner);
}

/**
 * A data association resolves only its data end by reference; the activity end is
 * its moddle `$parent`.
 */
function resolveEndpoints(edge: SceneEdge, byBusinessObject: Map<ModdleObject, Drawable>): void {
  let source = asNode(byBusinessObject.get(refBO(prop(edge.businessObject, 'sourceRef'))!));
  let target = asNode(byBusinessObject.get(refBO(prop(edge.businessObject, 'targetRef'))!));
  if (!source || !target) {
    const owner = asNode(byBusinessObject.get(parentOf(edge.businessObject)!));
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
 * Containment the `$parent` chain does not carry: a pool owns its process's nodes
 * through `processRef`, a lane its members through `flowNodeRef` (deepest lane wins).
 */
function collectRefContainment(byBusinessObject: Map<ModdleObject, Drawable>): Map<ModdleObject, ModdleObject> {
  const containment = new Map<ModdleObject, ModdleObject>();
  const claimDepth = new Map<ModdleObject, number>();
  for (const [bo, element] of byBusinessObject) {
    if (element.kind !== 'node') continue;
    if (bo.$type === PARTICIPANT_TYPE) {
      const processRef = asModdle(prop(bo, 'processRef'));
      if (processRef && processRef !== bo) containment.set(processRef, bo);
      continue;
    }
    if (bo.$type !== LANE_TYPE) continue;
    const depth = laneNesting(bo);
    for (const member of asList(prop(bo, 'flowNodeRef'))) {
      if (member === bo) continue;
      const claimed = claimDepth.get(member);
      if (claimed !== undefined && claimed >= depth) continue;
      containment.set(member, bo);
      claimDepth.set(member, depth);
    }
  }
  return containment;
}

function laneNesting(lane: ModdleObject): number {
  let depth = 0;
  const guard = new Set<ModdleObject>();
  for (let cursor = parentOf(lane); cursor && !guard.has(cursor); cursor = parentOf(cursor)) {
    guard.add(cursor);
    if (cursor.$type === LANE_TYPE) depth += 1;
  }
  return depth;
}

/** The nearest drawn node an element's business object sits in ({@link containerOf}); `undefined` at the top level. */
function findParentNode(
  element: Drawable,
  byBusinessObject: Map<ModdleObject, Drawable>,
  containment: Map<ModdleObject, ModdleObject>,
): SceneNode | undefined {
  const up = (bo: ModdleObject): ModdleObject | undefined => containment.get(bo) ?? containerOf(bo);
  const guard = new Set<ModdleObject>();
  for (let bo = up(element.businessObject); bo && !guard.has(bo); bo = up(bo)) {
    guard.add(bo);
    const node = asNode(byBusinessObject.get(bo));
    if (node && node !== element) return node;
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
