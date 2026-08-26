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

  for (const source of planeSources) {
    const rootNode = source.root ? asNode(byBusinessObject.get(source.root)) : undefined;
    const planeChildren: SceneElement[] = [];
    const elements: SceneElement[] = [
      ...(nodeOfPlane.get(source) ?? []),
      ...(edgeOfPlane.get(source) ?? []),
    ];
    for (const element of elements) {
      const parent = findParentNode(element, byBusinessObject, rootNode);
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
 * The containing node for an element: the nearest business-object ancestor that is
 * itself drawn (a subprocess, participant, lane), else the plane's own root node
 * (for a sub-plane, its subprocess), else `undefined` (top of the root plane).
 */
function findParentNode(
  element: SceneElement,
  byBusinessObject: Map<ModdleObject, SceneElement | SceneLabel>,
  rootNode: SceneNode | undefined,
): SceneNode | undefined {
  let bo: ModdleObject | undefined = parentOf(element.businessObject);
  const guard = new Set<ModdleObject>();
  while (bo && !guard.has(bo)) {
    guard.add(bo);
    const node = asNode(byBusinessObject.get(bo));
    if (node && node !== element) return node;
    bo = parentOf(bo);
  }
  return rootNode && rootNode !== element ? rootNode : undefined;
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
