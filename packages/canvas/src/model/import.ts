/**
 * Import — `bpmn:Definitions` (with DI already present) → {@link Scene}
 * (design §1 option (c), §3 `model/import.ts`).
 *
 * The document is a `bpmn-moddle` tree; all geometry lives in its DI subtree
 * `definitions.diagrams[]` (each a `bpmndi:BPMNDiagram`). This module walks every
 * diagram's `plane.planeElement[]`, joins each `bpmndi:BPMNShape`/`BPMNEdge` to the
 * business object it points at (`bpmnElement`), reads `dc:Bounds` → `x/y/width/height`
 * and `di:waypoint` → `waypoints`, resolves each edge's `source`/`target`, and
 * builds the parent/containment tree plus the nested planes that back expanded
 * subprocesses and choreographies.
 *
 * The DI is assumed present: the app runs `ensureDiagramLayout` (bpmn-auto-layout)
 * before the canvas ever sees the document (design §0), so the importer never
 * invents layout. Scene geometry fields mirror the backing DI moddle objects so a
 * later edit can write straight through them (`model/writeback.ts`).
 */

import type {
  ModdleObject,
  Plane,
  Point,
  Scene,
  SceneEdge,
  SceneElement,
  SceneLabel,
  SceneNode,
} from '@canvas/model/scene.ts';

/** Read a property off a moddle element, tolerating a plain parsed bag. */
function prop(target: ModdleObject | undefined, name: string): unknown {
  if (!target) return undefined;
  const getter = (target as { get?: (n: string) => unknown }).get;
  return typeof getter === 'function' ? getter.call(target, name) : (target as Record<string, unknown>)[name];
}

function asModdle(value: unknown): ModdleObject | undefined {
  return value && typeof value === 'object' && typeof (value as ModdleObject).$type === 'string'
    ? (value as ModdleObject)
    : undefined;
}

/** The moddle `$parent` back-link — a meta field, read directly (moddle `get` ignores `$`-names). */
function parentOf(target: ModdleObject | undefined): ModdleObject | undefined {
  return asModdle((target as { $parent?: unknown } | undefined)?.$parent);
}

function asList(value: unknown): ModdleObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ModdleObject => !!asModdle(item));
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The `bpmndi:BPMNPlane` local name test — a plane element is a shape, edge, or (nested) plane. */
const SHAPE_TYPE = 'bpmndi:BPMNShape';
const EDGE_TYPE = 'bpmndi:BPMNEdge';

const PARTICIPANT_TYPE = 'bpmn:Participant';
const LANE_TYPE = 'bpmn:Lane';

export interface ImportOptions {
  /** Sink for recoverable problems (dangling `bpmnElement`, missing bounds). Defaults to `console.warn`. */
  onWarning?: (message: string) => void;
}

interface PlaneSource {
  plane: ModdleObject;
  di: ModdleObject; // the BPMNDiagram
  root: ModdleObject | undefined; // plane.bpmnElement (root BO)
  shapes: ModdleObject[];
  edges: ModdleObject[];
}

/**
 * Build the scene graph from a `bpmn:Definitions` moddle tree that already carries
 * DI. Returns a {@link Scene} with every `BPMNShape` as a {@link SceneNode} (bounds
 * copied from `dc:Bounds`), every `BPMNEdge` as a {@link SceneEdge} (waypoints
 * copied from `di:waypoint`), edge `source`/`target` resolved, and the plane /
 * containment tree assembled.
 */
export function importDefinitions(definitions: ModdleObject, options: ImportOptions = {}): Scene {
  const warn = options.onWarning ?? ((message: string) => console.warn(`[canvas import] ${message}`));

  const elementsById = new Map<string, SceneElement | SceneLabel>();
  const byBusinessObject = new Map<ModdleObject, SceneElement | SceneLabel>();

  const planeSources = collectPlanes(definitions);
  const planes: Plane[] = [];

  // Pass 1 — every shape across every plane becomes a node, so a subprocess drawn
  // in the parent plane exists before its sub-plane's children resolve their parent.
  const nodeOfPlane = new Map<PlaneSource, SceneNode[]>();
  const edgeOfPlane = new Map<PlaneSource, SceneEdge[]>();
  for (const source of planeSources) {
    const nodes: SceneNode[] = [];
    for (const shape of source.shapes) {
      const node = buildNode(shape, warn);
      if (!node) continue;
      index(node, elementsById, byBusinessObject, warn);
      nodes.push(node);
    }
    nodeOfPlane.set(source, nodes);
  }

  // Pass 2 — edges (their endpoints are business objects that pass 1 already indexed).
  for (const source of planeSources) {
    const edges: SceneEdge[] = [];
    for (const shape of source.edges) {
      const edge = buildEdge(shape, warn);
      if (!edge) continue;
      index(edge, elementsById, byBusinessObject, warn);
      edges.push(edge);
    }
    edgeOfPlane.set(source, edges);
  }

  // Pass 3 — resolve edge endpoints and assemble the containment / plane tree.
  for (const source of planeSources) {
    for (const edge of edgeOfPlane.get(source) ?? []) resolveEndpoints(edge, byBusinessObject);
  }

  // Containment that the moddle `$parent` chain cannot express (pools, lanes).
  const refContainment = collectRefContainment(byBusinessObject);

  for (const source of planeSources) {
    const rootNode = source.root ? asNode(byBusinessObject.get(source.root)) : undefined;
    const planeChildren: SceneElement[] = [];
    const elements: SceneElement[] = [
      ...(nodeOfPlane.get(source) ?? []),
      ...(edgeOfPlane.get(source) ?? []),
    ];
    const parents = new Map<SceneElement, SceneNode | undefined>();
    for (const element of elements) {
      parents.set(element, findParentNode(element, byBusinessObject, rootNode, refContainment));
    }
    resolveLaneMembership(elements, parents);
    for (const element of elements) {
      const parent = parents.get(element);
      element.parent = parent;
      if (parent) parent.children.push(element);
      if (!parent || parent === rootNode) planeChildren.push(element);
    }
    planes.push({
      id: planeId(source),
      businessObject: source.root ?? source.plane,
      di: source.plane,
      children: planeChildren,
    });
  }

  const rootPlane = planes[0] ?? emptyPlane(definitions);
  if (planes.length === 0) planes.push(rootPlane);

  return {
    planes,
    rootPlane,
    elementsById,
    byBusinessObject,
    revision: 0,
  };
}

/** Every `bpmndi:BPMNDiagram`/plane pair, in document order (the first is the root). */
function collectPlanes(definitions: ModdleObject): PlaneSource[] {
  const diagrams = asList(prop(definitions, 'diagrams'));
  const sources: PlaneSource[] = [];
  for (const diagram of diagrams) {
    const plane = asModdle(prop(diagram, 'plane'));
    if (!plane) continue;
    const planeElements = asList(prop(plane, 'planeElement'));
    sources.push({
      plane,
      di: diagram,
      root: asModdle(prop(plane, 'bpmnElement')),
      shapes: planeElements.filter((el) => el.$type === SHAPE_TYPE),
      edges: planeElements.filter((el) => el.$type === EDGE_TYPE),
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
  const x = num(prop(bounds, 'x')) ?? 0;
  const y = num(prop(bounds, 'y')) ?? 0;
  const width = num(prop(bounds, 'width')) ?? 0;
  const height = num(prop(bounds, 'height')) ?? 0;
  if (!bounds) warn(`BPMNShape for ${idOf(businessObject) ?? '<no id>'} has no dc:Bounds — placed at 0,0`);

  const node: SceneNode = {
    id: idOf(businessObject) ?? idOf(shape) ?? '',
    kind: 'node',
    type: businessObject.$type,
    businessObject,
    di: shape,
    x,
    y,
    width,
    height,
    children: [],
    incoming: [],
    outgoing: [],
  };
  const isExpanded = prop(shape, 'isExpanded');
  if (typeof isExpanded === 'boolean') node.isExpanded = isExpanded;
  const isMarkerVisible = prop(shape, 'isMarkerVisible');
  if (typeof isMarkerVisible === 'boolean') node.isMarkerVisible = isMarkerVisible;

  attachLabel(node, shape, businessObject);
  return node;
}

function buildEdge(shape: ModdleObject, warn: (m: string) => void): SceneEdge | undefined {
  const businessObject = asModdle(prop(shape, 'bpmnElement'));
  if (!businessObject) {
    warn(`BPMNEdge ${idOf(shape) ?? '<no id>'} has no bpmnElement — skipped`);
    return undefined;
  }
  const waypoints: Point[] = asList(prop(shape, 'waypoint')).map((wp) => ({
    x: num(prop(wp, 'x')) ?? 0,
    y: num(prop(wp, 'y')) ?? 0,
  }));

  const edge: SceneEdge = {
    id: idOf(businessObject) ?? idOf(shape) ?? '',
    kind: 'edge',
    type: businessObject.$type,
    businessObject,
    di: shape,
    waypoints,
  };
  attachLabel(edge, shape, businessObject);
  return edge;
}

/** Attach an external/positioned label when the DI carries a `bpmndi:BPMNLabel` (owner text = BO `name`). */
function attachLabel(owner: SceneElement, di: ModdleObject, businessObject: ModdleObject): void {
  const labelDi = asModdle(prop(di, 'label'));
  if (!labelDi) return;
  const bounds = asModdle(prop(labelDi, 'bounds'));
  const label: SceneLabel = {
    id: `${owner.id}_label`,
    kind: 'label',
    businessObject,
    di: labelDi,
    owner,
  };
  const x = num(prop(bounds, 'x'));
  const y = num(prop(bounds, 'y'));
  const width = num(prop(bounds, 'width'));
  const height = num(prop(bounds, 'height'));
  if (x !== undefined) label.x = x;
  if (y !== undefined) label.y = y;
  if (width !== undefined) label.width = width;
  if (height !== undefined) label.height = height;
  owner.label = label;
}

/** Resolve `source`/`target` from the edge business object's `sourceRef`/`targetRef`. */
function resolveEndpoints(edge: SceneEdge, byBusinessObject: Map<ModdleObject, SceneElement | SceneLabel>): void {
  const source = asNode(byBusinessObject.get(refBO(prop(edge.businessObject, 'sourceRef'))!));
  const target = asNode(byBusinessObject.get(refBO(prop(edge.businessObject, 'targetRef'))!));
  if (source) {
    edge.source = source;
    if (!source.outgoing.includes(edge)) source.outgoing.push(edge);
  }
  if (target) {
    edge.target = target;
    if (!target.incoming.includes(edge)) target.incoming.push(edge);
  }
}

/** A ref may be a single BO or a `[BO, …]` list (data associations); take the first moddle element. */
function refBO(value: unknown): ModdleObject | undefined {
  if (Array.isArray(value)) return asModdle(value[0]);
  return asModdle(value);
}

/**
 * Containment links the moddle `$parent` chain does NOT carry, keyed by the CONTAINED
 * business object:
 *
 * - a `bpmn:Participant` (pool) owns its flow nodes through `processRef` — the nodes'
 *   `$parent` is the `bpmn:Process`, which is a sibling of the collaboration, so a
 *   `$parent`-only walk never reaches the pool. Mapping `processRef → participant`
 *   splices the pool into the walk exactly where the process sits.
 * - a `bpmn:Lane` owns its members through `flowNodeRef` — a *reference* list, not a
 *   containment one, so the members' `$parent` is again the process. The deepest
 *   (most nested) lane claiming a node wins.
 *
 * Without this, `Participant.children` / `Lane.children` are empty and dragging a pool
 * leaves its contents behind (and commits that broken geometry to the DI).
 */
function collectRefContainment(
  byBusinessObject: Map<ModdleObject, SceneElement | SceneLabel>,
): Map<ModdleObject, ModdleObject> {
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

/** How many `bpmn:Lane` ancestors `lane` has (a nested lane sits under a childLaneSet). */
function laneNesting(lane: ModdleObject): number {
  let depth = 0;
  let cursor = parentOf(lane);
  const guard = new Set<ModdleObject>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    if (cursor.$type === LANE_TYPE) depth += 1;
    cursor = parentOf(cursor);
  }
  return depth;
}

/** The next container up from `bo` — a reference link if one exists, else `$parent`. */
function containerOf(
  bo: ModdleObject,
  containment: Map<ModdleObject, ModdleObject>,
): ModdleObject | undefined {
  return containment.get(bo) ?? parentOf(bo);
}

/**
 * The containing node for an element: the nearest business-object ancestor that is
 * itself drawn (a subprocess, participant, lane), else the plane's own root node
 * (for a sub-plane, its subprocess), else `undefined` (top of the root plane).
 */
function findParentNode(
  element: SceneElement,
  byBusinessObject: Map<ModdleObject, SceneElement | SceneLabel>,
  rootNode: SceneNode | undefined,
  containment: Map<ModdleObject, ModdleObject>,
): SceneNode | undefined {
  let bo: ModdleObject | undefined = containerOf(element.businessObject, containment);
  const guard = new Set<ModdleObject>();
  while (bo && !guard.has(bo)) {
    guard.add(bo);
    const node = asNode(byBusinessObject.get(bo));
    if (node && node !== element) return node;
    bo = containerOf(bo, containment);
  }
  return rootNode && rootNode !== element ? rootNode : undefined;
}

/**
 * Geometric fallback for lane membership: a node that landed directly on a pool while
 * that pool is divided into lanes belongs to the lane it is drawn inside. Exporters
 * routinely omit `flowNodeRef` (it is optional), and without this such a node would not
 * follow its lane when the lane is dragged. Only nodes whose reference/`$parent`
 * containment stopped at the participant are re-homed, so an explicit `flowNodeRef`
 * always wins; the smallest containing lane of that pool takes the node.
 */
function resolveLaneMembership(
  elements: readonly SceneElement[],
  parents: Map<SceneElement, SceneNode | undefined>,
): void {
  const lanes = elements.filter(
    (element): element is SceneNode => element.kind === 'node' && element.type === LANE_TYPE,
  );
  if (lanes.length === 0) return;

  for (const element of elements) {
    if (element.kind !== 'node' || element.type === LANE_TYPE) continue;
    const pool = parents.get(element);
    if (!pool || pool.type !== PARTICIPANT_TYPE) continue;
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    let best: SceneNode | undefined;
    let bestArea = Infinity;
    for (const lane of lanes) {
      if (poolOfLane(lane, parents) !== pool) continue;
      if (cx < lane.x || cx > lane.x + lane.width) continue;
      if (cy < lane.y || cy > lane.y + lane.height) continue;
      const area = lane.width * lane.height;
      if (area < bestArea) {
        best = lane;
        bestArea = area;
      }
    }
    if (best) parents.set(element, best);
  }
}

/** Walk `lane`'s (possibly nested) lane ancestry up to the pool that owns it. */
function poolOfLane(
  lane: SceneNode,
  parents: Map<SceneElement, SceneNode | undefined>,
): SceneNode | undefined {
  let cursor: SceneNode | undefined = parents.get(lane);
  const guard = new Set<SceneNode>();
  while (cursor && cursor.type === LANE_TYPE && !guard.has(cursor)) {
    guard.add(cursor);
    cursor = parents.get(cursor);
  }
  return cursor;
}

function index(
  element: SceneElement,
  elementsById: Map<string, SceneElement | SceneLabel>,
  byBusinessObject: Map<ModdleObject, SceneElement | SceneLabel>,
  warn: (m: string) => void,
): void {
  if (element.id) {
    if (elementsById.has(element.id)) warn(`duplicate element id '${element.id}' — later one wins`);
    elementsById.set(element.id, element);
  }
  byBusinessObject.set(element.businessObject, element);
  if (element.label) {
    if (element.label.id) elementsById.set(element.label.id, element.label);
  }
}

function asNode(value: SceneElement | SceneLabel | undefined): SceneNode | undefined {
  return value && value.kind === 'node' ? value : undefined;
}

function idOf(target: ModdleObject | undefined): string | undefined {
  const id = prop(target, 'id');
  return typeof id === 'string' && id ? id : undefined;
}

function planeId(source: PlaneSource): string {
  return idOf(source.plane) ?? idOf(source.di) ?? `${idOf(source.root) ?? 'plane'}_plane`;
}

function emptyPlane(definitions: ModdleObject): Plane {
  return { id: 'plane', businessObject: definitions, di: definitions, children: [] };
}
