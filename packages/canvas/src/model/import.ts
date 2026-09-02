/**
 * `bpmn:Definitions` (with DI) → {@link Scene}.
 *
 * Every plane's shapes and edges join one tree. A nested plane's contents are
 * parented under the container that owns the plane and keep the coordinates the
 * document gave them; expanding the container is what moves them into its frame
 * (`model/mutator.ts`).
 */

import { readColorsOf } from '@canvas/model/color.ts';
import { mintLabel, syncLabel } from '@canvas/model/labels.ts';
import { asList, asModdle, parentOf, prop, refBO } from '@canvas/model/moddle.ts';
import type {
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
}

const SHAPE_TYPE = 'bpmndi:BPMNShape';
const EDGE_TYPE = 'bpmndi:BPMNEdge';
const PARTICIPANT_TYPE = 'bpmn:Participant';
const LANE_TYPE = 'bpmn:Lane';
const DATA_INPUT_ASSOCIATION = 'bpmn:DataInputAssociation';
const DATA_OUTPUT_ASSOCIATION = 'bpmn:DataOutputAssociation';

interface PlaneSource {
  root: ModdleObject | undefined;
  shapes: ModdleObject[];
  edges: ModdleObject[];
}

type Drawable = SceneNode | SceneEdge;

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
  const planes = collectPlanes(definitions);

  const index = (element: Drawable): void => {
    if (element.id) {
      if (elementsById.has(element.id)) warn(`duplicate element id '${element.id}' — later one wins`);
      elementsById.set(element.id, element);
    }
    byBusinessObject.set(element.businessObject, element);
  };

  // Shapes first, across every plane, so a nested plane's contents can find their container.
  const shapesOf = new Map<PlaneSource, SceneNode[]>();
  const edgesOf = new Map<PlaneSource, SceneEdge[]>();
  for (const plane of planes) {
    const nodes: SceneNode[] = [];
    for (const shape of plane.shapes) {
      const node = buildNode(shape, warn);
      if (node) {
        index(node);
        nodes.push(node);
      }
    }
    shapesOf.set(plane, nodes);
  }
  for (const plane of planes) {
    const edges: SceneEdge[] = [];
    for (const di of plane.edges) {
      const edge = buildEdge(di, warn);
      if (edge) {
        index(edge);
        edges.push(edge);
      }
    }
    edgesOf.set(plane, edges);
  }
  for (const edges of edgesOf.values()) for (const edge of edges) resolveEndpoints(edge, byBusinessObject);

  const refContainment = collectRefContainment(byBusinessObject);
  const children: SceneElement[] = [];
  for (const plane of planes) {
    const owner = plane.root ? asNode(byBusinessObject.get(plane.root)) : undefined;
    const elements: Drawable[] = [...(shapesOf.get(plane) ?? []), ...(edgesOf.get(plane) ?? [])];
    const parents = new Map<Drawable, SceneNode | undefined>();
    for (const element of elements) {
      parents.set(element, findParentNode(element, byBusinessObject, owner, refContainment));
    }
    resolveLaneMembership(elements, parents);
    for (const element of elements) {
      const parent = parents.get(element);
      element.parent = parent;
      if (parent) parent.children.push(element);
      else children.push(element);
    }
  }

  const root = planes[0]?.root ?? asList(prop(definitions, 'rootElements'))[0] ?? definitions;
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

function collectPlanes(definitions: ModdleObject): PlaneSource[] {
  const sources: PlaneSource[] = [];
  for (const diagram of asList(prop(definitions, 'diagrams'))) {
    const plane = asModdle(prop(diagram, 'plane'));
    if (!plane) continue;
    const elements = asList(prop(plane, 'planeElement'));
    sources.push({
      root: asModdle(prop(plane, 'bpmnElement')),
      shapes: elements.filter((el) => el.$type === SHAPE_TYPE),
      edges: elements.filter((el) => el.$type === EDGE_TYPE),
    });
  }
  return sources;
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

/** The nearest drawn ancestor of an element's business object, else the plane's owner. */
function findParentNode(
  element: Drawable,
  byBusinessObject: Map<ModdleObject, Drawable>,
  owner: SceneNode | undefined,
  containment: Map<ModdleObject, ModdleObject>,
): SceneNode | undefined {
  const up = (bo: ModdleObject): ModdleObject | undefined => containment.get(bo) ?? parentOf(bo);
  const guard = new Set<ModdleObject>();
  for (let bo = up(element.businessObject); bo && !guard.has(bo); bo = up(bo)) {
    guard.add(bo);
    const node = asNode(byBusinessObject.get(bo));
    if (node && node !== element) return node;
  }
  return owner && owner !== element ? owner : undefined;
}

/** A node drawn inside a lane of its pool belongs to that lane even without a `flowNodeRef`. */
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
    if (!pool || pool.type !== PARTICIPANT_TYPE) continue;
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
