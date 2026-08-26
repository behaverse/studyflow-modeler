/**
 * Writeback — apply scene geometry edits to the backing DI moddle objects in place
 * (design §1 "what must be written back on every edit", §3 `model/writeback.ts`).
 *
 * The core contract (design §1 option (c)): a geometry edit mutates BOTH the scene
 * field (`node.x/width`, `edge.waypoints`) AND the live DI moddle object the scene
 * was imported from (`di.bounds` — a `dc:Bounds`; `di.waypoint` — a `dc:Point[]`),
 * so `bpmn-moddle` re-serializes the edited document and the `.studyflow` inline-DI
 * folding picks the change up. Nothing here re-serializes or rebuilds the
 * `Definitions` tree — it mutates the very objects `model/import.ts` referenced,
 * using the same moddle instance/factory reached through the DI object's `$model`.
 *
 * Every committing call bumps {@link Scene.revision} (the facade's mutation counter,
 * design §4) and fires `element.changed` / `elements.changed` on the bus.
 */

import { getDefaults, getExtensionType, StudyflowElement } from '@core/element/index.ts';
import { isBpmnSubtypeOf } from '@core/notation/bpmn.ts';

import type { EventBus } from '@canvas/events/bus.ts';
import { IdGenerator } from '@canvas/model/ids.ts';
import type {
  Bounds,
  ModdleObject,
  Plane,
  Point,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';
import { containerFor } from '@canvas/rules/rules.ts';

/** Payload for the `element.changed` event (one element edited). */
export interface ElementChangedEvent {
  element: SceneElement;
}

/** Payload for the `elements.changed` event (a batch edited together). */
export interface ElementsChangedEvent {
  elements: SceneElement[];
}

/** A partial bounds patch — only the provided fields are written. */
export interface PartialBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** The moddle `$type` used for edge waypoints in BPMN DI (`di:waypoint` of `dc:Point`). */
const WAYPOINT_TYPE = 'dc:Point';
/** The moddle `$type` of a shape's bounds. */
const BOUNDS_TYPE = 'dc:Bounds';
/** DI wrapper types minted when a shape/connection is created. */
const SHAPE_DI_TYPE = 'bpmndi:BPMNShape';
const EDGE_DI_TYPE = 'bpmndi:BPMNEdge';

// --- moddle access helpers --------------------------------------------------

/** Read a property off a moddle element, tolerating a plain parsed bag. */
function prop(target: ModdleObject | undefined, name: string): unknown {
  if (!target) return undefined;
  const getter = (target as { get?: (n: string) => unknown }).get;
  return typeof getter === 'function'
    ? getter.call(target, name)
    : (target as Record<string, unknown>)[name];
}

/** Set a property on a moddle element via its `set`, else assign directly. */
function setProp(target: ModdleObject, name: string, value: unknown): void {
  const setter = (target as { set?: (n: string, v: unknown) => void }).set;
  if (typeof setter === 'function') setter.call(target, name, value);
  else (target as Record<string, unknown>)[name] = value;
}

function asModdle(value: unknown): ModdleObject | undefined {
  return value && typeof value === 'object' && typeof (value as ModdleObject).$type === 'string'
    ? (value as ModdleObject)
    : undefined;
}

/** A moddle factory: the `$model` a moddle object was minted by. */
type ModdleFactory = { create?: (type: string, props: object) => ModdleObject };

/** The moddle factory that minted `target` (`$model`), if any. */
function modelOf(target: ModdleObject | undefined): ModdleFactory | undefined {
  const model = (target as { $model?: unknown } | undefined)?.$model;
  return model && typeof model === 'object' ? (model as ModdleFactory) : undefined;
}

/** The moddle `$parent` back-link (a meta field moddle's `get` does not serve). */
function parentOf(target: ModdleObject | undefined): ModdleObject | undefined {
  return asModdle((target as { $parent?: unknown } | undefined)?.$parent);
}

function setParent(child: ModdleObject, parent: ModdleObject | undefined): void {
  if (parent) (child as { $parent?: unknown }).$parent = parent;
}

/**
 * Mint a moddle object of `type` through `factory` (the `$model` of an object the
 * document already holds), falling back to a plain bag when no factory is reachable
 * — the same defensive shape the sync helpers above use, so a hand-built test scene
 * without a real `bpmn-moddle` still works.
 */
function mint(factory: ModdleFactory | undefined, type: string, props: object = {}): ModdleObject {
  if (factory?.create) return factory.create(type, props);
  return { $type: type, ...props } as ModdleObject;
}

/** Whether `name` is a list-valued (`isMany`) property of `target`'s moddle descriptor. */
function isManyProperty(target: ModdleObject, name: string): boolean {
  const descriptor = (target as {
    $descriptor?: { propertiesByName?: Record<string, { isMany?: boolean } | undefined> };
  }).$descriptor;
  return descriptor?.propertiesByName?.[name]?.isMany === true;
}

/** Append `value` to the list-valued property `name` of `owner`, creating the list if absent. */
function pushInto(owner: ModdleObject, name: string, value: ModdleObject): void {
  const current = prop(owner, name);
  if (Array.isArray(current)) {
    if (!current.includes(value)) current.push(value);
    return;
  }
  setProp(owner, name, [value]);
}

/** Remove `value` from the list-valued property `name` of `owner` (no-op when absent). */
function pullFrom(owner: ModdleObject | undefined, name: string, value: ModdleObject): void {
  if (!owner) return;
  const current = prop(owner, name);
  if (!Array.isArray(current)) return;
  const index = current.indexOf(value);
  if (index >= 0) current.splice(index, 1);
}

/**
 * Write a reference property, honouring the schema's cardinality: `sourceRef` is a
 * single `bpmn:FlowNode` on a `bpmn:SequenceFlow` but a *list* of item-aware
 * elements on a `bpmn:DataInputAssociation`, so the descriptor decides.
 */
function setRef(owner: ModdleObject, name: string, value: ModdleObject | undefined): void {
  if (!value) {
    setProp(owner, name, isManyProperty(owner, name) ? [] : undefined);
    return;
  }
  setProp(owner, name, isManyProperty(owner, name) ? [value] : value);
}

/** The `bpmn:Definitions` root reachable from a scene's root plane, if any. */
export function definitionsOf(scene: Scene): ModdleObject | undefined {
  let cursor: ModdleObject | undefined = scene.rootPlane.di;
  const guard = new Set<ModdleObject>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    if (cursor.$type === 'bpmn:Definitions') return cursor;
    cursor = parentOf(cursor);
  }
  return undefined;
}

// --- containment resolution -------------------------------------------------

/** Where a created shape's business object is filed, and the lane that claims it. */
export interface FlowContainer {
  /** The business object that owns the new element (`bpmn:Process`, `bpmn:SubProcess`, `bpmn:Collaboration`). */
  owner: ModdleObject;
  /** The `bpmn:Lane` the drop landed in, when the pool is divided into lanes. */
  lane?: ModdleObject;
}

/**
 * The business object a shape dropped onto `parent` really belongs to (design §1
 * "add shape … into `flowElements`").
 *
 * A `bpmn:Group` owns no `flowElements`, so a drop on one resolves to the group's
 * container ({@link containerFor}); a `bpmn:Lane` owns its members by *reference*
 * (`flowNodeRef`), so the lane is remembered but the owner walks on to the pool;
 * a `bpmn:Participant` files its contents in the `bpmn:Process` it points at.
 * With no containing node at all the plane's own root business object owns it.
 */
export function flowContainerOf(parent: SceneNode | undefined, plane: Plane): FlowContainer {
  let lane: ModdleObject | undefined;
  let node = containerFor(parent) as SceneNode | undefined;
  const guard = new Set<SceneNode>();
  while (node && node.type === 'bpmn:Lane' && !guard.has(node)) {
    guard.add(node);
    lane ??= node.businessObject;
    node = containerFor(node.parent) as SceneNode | undefined;
  }
  if (!node) return lane ? { owner: plane.businessObject, lane } : { owner: plane.businessObject };
  if (node.type === 'bpmn:Participant') {
    const processRef = asModdle(prop(node.businessObject, 'processRef'));
    const owner = processRef ?? node.businessObject;
    return lane ? { owner, lane } : { owner };
  }
  return lane ? { owner: node.businessObject, lane } : { owner: node.businessObject };
}

/**
 * The container property a business object of `type` is filed under: pools live in
 * a collaboration's `participants`, groups and text annotations in `artifacts`,
 * everything else (flow nodes, data shapes) in `flowElements`.
 */
export function containmentPropertyFor(type: string): 'participants' | 'artifacts' | 'flowElements' {
  if (type === 'bpmn:Participant') return 'participants';
  if (isBpmnSubtypeOf(type, 'bpmn:Artifact')) return 'artifacts';
  return 'flowElements';
}

/** The `bpmn:Collaboration` a message flow is filed in, if the document has one. */
function collaborationOf(scene: Scene, plane: Plane): ModdleObject | undefined {
  if (plane.businessObject.$type === 'bpmn:Collaboration') return plane.businessObject;
  for (const candidate of scene.byBusinessObject.keys()) {
    const owner = parentOf(candidate);
    if (owner?.$type === 'bpmn:Collaboration') return owner;
  }
  return undefined;
}

// --- pure DI sync (no revision bump, no events) -----------------------------

/**
 * Write a node's current scene geometry into its backing `dc:Bounds`, creating one
 * (via the DI object's `$model`) if the shape has none, and carry its external label
 * along ({@link syncLabelBoundsToDi}). Scene → DI only.
 */
export function syncNodeBoundsToDi(node: SceneNode): void {
  const di = node.di;
  if (!di) {
    syncLabelBoundsToDi(node);
    return;
  }
  let bounds = asModdle(prop(di, 'bounds'));
  if (!bounds) {
    const model = modelOf(di);
    bounds = model?.create
      ? model.create(BOUNDS_TYPE, { x: node.x, y: node.y, width: node.width, height: node.height })
      : ({ $type: BOUNDS_TYPE, x: node.x, y: node.y, width: node.width, height: node.height } as ModdleObject);
    (bounds as { $parent?: unknown }).$parent = di;
    setProp(di, 'bounds', bounds);
    syncLabelBoundsToDi(node);
    return;
  }
  setProp(bounds, 'x', node.x);
  setProp(bounds, 'y', node.y);
  setProp(bounds, 'width', node.width);
  setProp(bounds, 'height', node.height);
  syncLabelBoundsToDi(node);
}

/**
 * Write an element's external label position into its backing `bpmndi:BPMNLabel`'s
 * `dc:Bounds`, so a moved/resized shape's label survives re-serialization instead of
 * detaching (the label is drawn from `label.x/y` — see `render/labels.ts`).
 *
 * Deliberately conservative: it never mints a `bpmndi:BPMNLabel`, and it writes
 * nothing when the label is unpositioned (no `dc:Bounds` in the source document, so
 * the renderer derives placement from the owner and there is nothing to keep in
 * sync). It only mints a `dc:Bounds` for a `BPMNLabel` that has none once the scene
 * knows where the label sits. Scene → DI only.
 */
export function syncLabelBoundsToDi(element: SceneElement): void {
  const label = element.label;
  if (!label) return;
  const labelDi = label.di;
  if (!labelDi) return;
  if (label.x === undefined || label.y === undefined) return;
  let bounds = asModdle(prop(labelDi, 'bounds'));
  if (!bounds) {
    const model = modelOf(labelDi);
    const props = { x: label.x, y: label.y, width: label.width ?? 0, height: label.height ?? 0 };
    bounds = model?.create
      ? model.create(BOUNDS_TYPE, props)
      : ({ $type: BOUNDS_TYPE, ...props } as ModdleObject);
    (bounds as { $parent?: unknown }).$parent = labelDi;
    setProp(labelDi, 'bounds', bounds);
    return;
  }
  setProp(bounds, 'x', label.x);
  setProp(bounds, 'y', label.y);
  if (label.width !== undefined) setProp(bounds, 'width', label.width);
  if (label.height !== undefined) setProp(bounds, 'height', label.height);
}

/**
 * Translate an element's external label by `(dx, dy)` in the SCENE only. A label with
 * no explicit position is left alone — the renderer derives it from the owner, so it
 * follows for free.
 */
export function translateLabel(element: SceneElement, dx: number, dy: number): void {
  const label = element.label;
  if (!label || (dx === 0 && dy === 0)) return;
  if (label.x !== undefined) label.x += dx;
  if (label.y !== undefined) label.y += dy;
}

/**
 * Rebuild an edge's backing `di:waypoint` list from its current scene waypoints,
 * reusing existing `dc:Point` moddle objects where the count lines up (mutating
 * their `x`/`y`) and minting the rest through the DI object's `$model`. Scene → DI
 * only.
 */
export function syncEdgeWaypointsToDi(edge: SceneEdge): void {
  const di = edge.di;
  if (!di) {
    syncLabelBoundsToDi(edge);
    return;
  }
  const existing = Array.isArray(prop(di, 'waypoint'))
    ? (prop(di, 'waypoint') as ModdleObject[])
    : [];
  const type = existing[0]?.$type ?? WAYPOINT_TYPE;
  const model = modelOf(di);
  const list: ModdleObject[] = edge.waypoints.map((p, i) => {
    const reuse = existing[i];
    if (reuse && reuse.$type === type) {
      setProp(reuse, 'x', p.x);
      setProp(reuse, 'y', p.y);
      return reuse;
    }
    const created = model?.create
      ? model.create(type, { x: p.x, y: p.y })
      : ({ $type: type, x: p.x, y: p.y } as ModdleObject);
    (created as { $parent?: unknown }).$parent = di;
    return created;
  });
  setProp(di, 'waypoint', list);
  syncLabelBoundsToDi(edge);
}

/**
 * Shift the docking waypoint of every edge connected to `node` by `(dx, dy)` in the
 * SCENE only (an outgoing edge's first waypoint, an incoming edge's last). This is
 * the minimal "endpoints follow the node" behaviour — full orthogonal re-routing is
 * a later phase (design §3 routing). Returns the edges it touched.
 */
export function dockConnectedEdges(node: SceneNode, dx: number, dy: number): SceneEdge[] {
  if (dx === 0 && dy === 0) return [];
  const affected: SceneEdge[] = [];
  const push = (e: SceneEdge): void => {
    if (!affected.includes(e)) affected.push(e);
  };
  for (const edge of node.outgoing) {
    if (edge.waypoints.length === 0) continue;
    const w = edge.waypoints[0];
    edge.waypoints[0] = { x: w.x + dx, y: w.y + dy };
    push(edge);
  }
  for (const edge of node.incoming) {
    const n = edge.waypoints.length;
    if (n === 0) continue;
    const w = edge.waypoints[n - 1];
    edge.waypoints[n - 1] = { x: w.x + dx, y: w.y + dy };
    push(edge);
  }
  return affected;
}

// --- committing API ---------------------------------------------------------

/** What {@link Writeback.addShape} needs to mint a business object + `BPMNShape` pair. */
export interface AddShapeSpec {
  /** The BPMN type to mint (`'bpmn:Task'`). Ignored when {@link AddShapeSpec.businessObject} is given. */
  type: string;
  /** Where the shape lands, in diagram coordinates. */
  bounds: Bounds;
  /** A pre-built business object (the app's palette builds one; see `shape/buildBusinessObject.ts`). */
  businessObject?: ModdleObject;
  /** Attributes written onto the business object (`name`, …). */
  attrs?: Record<string, unknown>;
  /** Studyflow extension type (`'cognitive:Instruction'`) — mints the `extensionElements` wrapper + defaults. */
  extensionType?: string;
  /** The containing node the shape was dropped into; `undefined` = the plane root. */
  parent?: SceneNode;
  /** The plane the `BPMNShape` is filed in. Defaults to the scene's root plane. */
  plane?: Plane;
  /** `BPMNShape.isExpanded` (sub-processes / pools). */
  isExpanded?: boolean;
  /** Host activity for a boundary event (the `'attach'` verdict of `rules.canCreate`). */
  attachTo?: SceneNode;
  /** Explicit id; minted from {@link IdGenerator} when absent. */
  id?: string;
}

/** What {@link Writeback.addConnection} needs to mint a flow + `BPMNEdge` pair. */
export interface AddConnectionSpec {
  /** The BPMN type to mint (`'bpmn:SequenceFlow'`, `'bpmn:MessageFlow'`, `'bpmn:Association'`, …). */
  type: string;
  source: SceneNode;
  target: SceneNode;
  /** Routed (and cropped) waypoints — see `routing/orthogonal.ts` `route`. */
  waypoints?: Point[];
  businessObject?: ModdleObject;
  attrs?: Record<string, unknown>;
  extensionType?: string;
  plane?: Plane;
  id?: string;
}

/** The endpoints a {@link Writeback.reconnect} rewrites; omit one to keep it. */
export interface ReconnectEnds {
  source?: SceneNode;
  target?: SceneNode;
}

/**
 * Applies scene geometry edits through to the DI moddle objects, bumping the scene
 * revision and firing `element.changed` / `elements.changed`. Constructed with the
 * live {@link Scene} and {@link EventBus} the canvas owns.
 *
 * From P4 it is also the single place that *creates* business-object + DI pairs
 * ({@link Writeback.addShape}, {@link Writeback.addConnection}) and rewires an
 * existing connection ({@link Writeback.reconnect}) — always writing into the very
 * moddle tree the scene was imported from, through the factory (`$model`) that
 * minted it, so `bpmn-moddle` re-serializes everything the canvas created.
 */
export class Writeback {
  private readonly scene: Scene;
  private readonly bus: EventBus;
  private readonly idGenerator: IdGenerator;

  constructor(scene: Scene, bus: EventBus, ids?: IdGenerator) {
    this.scene = scene;
    this.bus = bus;
    // With no generator handed in, seed one from the live document so nothing minted
    // here can collide with an id the imported tree already carries.
    this.idGenerator = ids ?? IdGenerator.fromDefinitions(definitionsOf(scene) ?? scene.rootPlane.di);
    // Belt and braces for a hand-built scene whose plane is not wired to a document.
    for (const id of scene.elementsById.keys()) this.idGenerator.claim(id);
  }

  /** The document-scoped id source new elements draw from. */
  get ids(): IdGenerator {
    return this.idGenerator;
  }

  /**
   * Move and/or resize `node` to `bounds` (only the provided fields change): update
   * the scene fields, carry an external label along by the shape's centre delta, drag
   * its connected edges' docking waypoints by the same top-left delta, write the
   * node's `dc:Bounds`, its `bpmndi:BPMNLabel`'s bounds and each moved edge's
   * `di:waypoint`, bump the revision, and fire the change events. Returns the
   * elements that changed (the node first, then any followed edges).
   */
  setNodeBounds(node: SceneNode, bounds: PartialBounds): SceneElement[] {
    const oldX = node.x;
    const oldY = node.y;
    const oldCx = node.x + node.width / 2;
    const oldCy = node.y + node.height / 2;
    if (bounds.x !== undefined) node.x = bounds.x;
    if (bounds.y !== undefined) node.y = bounds.y;
    if (bounds.width !== undefined) node.width = Math.max(0, bounds.width);
    if (bounds.height !== undefined) node.height = Math.max(0, bounds.height);

    translateLabel(node, node.x + node.width / 2 - oldCx, node.y + node.height / 2 - oldCy);
    const edges = dockConnectedEdges(node, node.x - oldX, node.y - oldY);
    syncNodeBoundsToDi(node);
    for (const edge of edges) syncEdgeWaypointsToDi(edge);

    const changed: SceneElement[] = [node, ...edges];
    this.finish(changed);
    return changed;
  }

  /**
   * Write `name` onto a moddle object in place and report the edit as a change to
   * `elements`. `target` defaults to the first element's own business object (the
   * ordinary label edit); `interaction/labelEditing.ts` passes a choreography
   * participant instead when a band is edited, mirroring the modeler's
   * `modeling.updateModdleProperties(element, participant, { name })`.
   *
   * A single `target` can be depicted by several elements — one `bpmn:Participant` is
   * referenced by every choreography task it takes part in — which is why `elements`
   * is a list: one write, one revision bump, `element.changed` for each depiction.
   *
   * A no-op edit (same text, or clearing an already-absent name) neither bumps the
   * revision nor fires — so an inline editor closed unchanged leaves no trace.
   * Returns whether anything was written.
   */
  setName(elements: SceneElement | SceneElement[], name: string, target?: ModdleObject): boolean {
    const list = Array.isArray(elements) ? elements : [elements];
    const bo = target ?? list[0]?.businessObject;
    if (!bo || list.length === 0) return false;
    const current = prop(bo, 'name');
    if ((typeof current === 'string' ? current : '') === name) return false;
    setProp(bo, 'name', name);
    this.finish(list);
    return true;
  }

  /**
   * Record that `element` changed without writing any property here — for edits that
   * mutated the moddle tree through another path (e.g. minting a choreography
   * participant pair). Bumps the revision and fires `element.changed`.
   */
  touch(element: SceneElement): void {
    this.finish([element]);
  }

  /** Replace `edge`'s waypoints (scene + `di:waypoint`), bump the revision, fire. */
  setEdgeWaypoints(edge: SceneEdge, points: Point[]): void {
    edge.waypoints = points.map((p) => ({ x: p.x, y: p.y }));
    syncEdgeWaypointsToDi(edge);
    this.finish([edge]);
  }

  /**
   * Commit already-updated scene geometry for `elements` (the drag path mutates the
   * scene live, then commits on drop): write each element's DI, bump the revision,
   * fire the change events.
   */
  commit(elements: SceneElement[]): void {
    for (const el of elements) {
      if (el.kind === 'node') syncNodeBoundsToDi(el);
      else syncEdgeWaypointsToDi(el);
    }
    if (elements.length > 0) this.finish(elements);
  }

  // --- creation (design §1 "add shape" / "add edge") ------------------------

  /**
   * Create a shape: mint the business object into the drop target's container AND
   * the `bpmndi:BPMNShape` + `dc:Bounds` into the plane, then index the resulting
   * {@link SceneNode} in the scene, bump the revision and fire `element.changed`.
   *
   * Both halves are written into the live moddle tree through the factory that
   * minted the plane (`$model`), so `bpmn-moddle`'s `toXML` emits the new element
   * and its DI without any further bookkeeping (design §1, the P3 write-through
   * contract extended to creation).
   *
   * Containment follows {@link flowContainerOf}: a pool files into its
   * `processRef`'s `flowElements`, a lane additionally claims the node through
   * `flowNodeRef`, a group hands the drop to its own container, artifacts go to
   * `artifacts` and pools to the collaboration's `participants`.
   */
  addShape(spec: AddShapeSpec): SceneNode {
    const scene = this.scene;
    const plane = spec.plane ?? scene.rootPlane;
    const factory = modelOf(plane.di)
      ?? modelOf(spec.businessObject)
      ?? modelOf(plane.businessObject);

    const bo = spec.businessObject ?? mint(factory, spec.type, { ...(spec.attrs ?? {}) });
    if (spec.businessObject && spec.attrs) {
      for (const [name, value] of Object.entries(spec.attrs)) setProp(bo, name, value);
    }
    const type = typeof bo.$type === 'string' ? bo.$type : spec.type;
    const id = spec.id
      ?? (typeof bo.id === 'string' && bo.id ? bo.id : this.idGenerator.next(spec.extensionType ?? type, bo));
    bo.id = id;
    this.idGenerator.claim(id);

    if (spec.extensionType && factory?.create && !getExtensionType(bo)) {
      StudyflowElement.fromBusinessObject(bo).ensureExtension(
        spec.extensionType,
        factory as never,
        getDefaults(spec.extensionType),
      );
    }

    // A boundary event is filed in its host's container and points at the host.
    const parentNode = spec.attachTo ? spec.attachTo.parent : spec.parent;
    if (spec.attachTo) setRef(bo, 'attachedToRef', spec.attachTo.businessObject);

    const { owner, lane } = flowContainerOf(parentNode, plane);
    this.fileBusinessObject(bo, type, owner, factory);
    if (lane && isBpmnSubtypeOf(type, 'bpmn:FlowNode')) pushInto(lane, 'flowNodeRef', bo);

    const di = mint(factory, SHAPE_DI_TYPE, { id: this.diIdFor(id), bpmnElement: bo });
    setParent(di, plane.di);
    if (spec.isExpanded !== undefined) setProp(di, 'isExpanded', spec.isExpanded);
    pushInto(plane.di, 'planeElement', di);

    const node: SceneNode = {
      id,
      kind: 'node',
      type,
      businessObject: bo,
      di,
      x: spec.bounds.x,
      y: spec.bounds.y,
      width: spec.bounds.width,
      height: spec.bounds.height,
      children: [],
      incoming: [],
      outgoing: [],
    };
    if (spec.isExpanded !== undefined) node.isExpanded = spec.isExpanded;

    if (parentNode) {
      node.parent = parentNode;
      parentNode.children.push(node);
    } else {
      plane.children.push(node);
    }
    scene.elementsById.set(id, node);
    scene.byBusinessObject.set(bo, node);

    // Mints the `dc:Bounds` the shape has none of yet, from the scene geometry.
    syncNodeBoundsToDi(node);
    this.finish([node]);
    return node;
  }

  /**
   * Create a connection: mint the flow business object (`sourceRef`/`targetRef`,
   * and — for a sequence flow — the endpoints' `outgoing`/`incoming` reference
   * lists) AND the `bpmndi:BPMNEdge` + `di:waypoint` list, then index the resulting
   * {@link SceneEdge}, bump the revision and fire.
   *
   * `outgoing`/`incoming` on a `bpmn:FlowNode` are typed `bpmn:SequenceFlow` in the
   * BPMN schema, so a message flow / association is deliberately *not* pushed onto
   * them; the scene's own `source.outgoing` / `target.incoming` lists always get the
   * edge (mirroring `model/import.ts`), which is what routing and drag read.
   */
  addConnection(spec: AddConnectionSpec): SceneEdge {
    const scene = this.scene;
    const plane = spec.plane ?? scene.rootPlane;
    const factory = modelOf(plane.di)
      ?? modelOf(spec.businessObject)
      ?? modelOf(spec.source.businessObject);

    const bo = spec.businessObject ?? mint(factory, spec.type, { ...(spec.attrs ?? {}) });
    if (spec.businessObject && spec.attrs) {
      for (const [name, value] of Object.entries(spec.attrs)) setProp(bo, name, value);
    }
    const type = typeof bo.$type === 'string' ? bo.$type : spec.type;
    const id = spec.id
      ?? (typeof bo.id === 'string' && bo.id ? bo.id : this.idGenerator.next(spec.extensionType ?? type, bo));
    bo.id = id;
    this.idGenerator.claim(id);

    if (spec.extensionType && factory?.create && !getExtensionType(bo)) {
      StudyflowElement.fromBusinessObject(bo).ensureExtension(
        spec.extensionType,
        factory as never,
        getDefaults(spec.extensionType),
      );
    }

    setRef(bo, 'sourceRef', spec.source.businessObject);
    setRef(bo, 'targetRef', spec.target.businessObject);
    if (isBpmnSubtypeOf(type, 'bpmn:SequenceFlow')) {
      pushInto(spec.source.businessObject, 'outgoing', bo);
      pushInto(spec.target.businessObject, 'incoming', bo);
    }
    this.fileConnection(bo, type, spec.source, spec.target, plane);

    const di = mint(factory, EDGE_DI_TYPE, { id: this.diIdFor(id), bpmnElement: bo });
    setParent(di, plane.di);
    pushInto(plane.di, 'planeElement', di);

    const edge: SceneEdge = {
      id,
      kind: 'edge',
      type,
      businessObject: bo,
      di,
      waypoints: (spec.waypoints ?? []).map((p) => ({ x: p.x, y: p.y })),
      source: spec.source,
      target: spec.target,
    };
    spec.source.outgoing.push(edge);
    spec.target.incoming.push(edge);

    // A connection is drawn in the container both its ends share; a cross-container
    // one (a message flow) belongs to the plane itself.
    const parentNode = spec.source.parent && spec.source.parent === spec.target.parent
      ? spec.source.parent
      : undefined;
    if (parentNode) {
      edge.parent = parentNode;
      parentNode.children.push(edge);
    } else {
      plane.children.push(edge);
    }
    scene.elementsById.set(id, edge);
    scene.byBusinessObject.set(bo, edge);

    // Mints the `di:waypoint` list from the scene waypoints.
    syncEdgeWaypointsToDi(edge);
    this.finish([edge, spec.source, spec.target]);
    return edge;
  }

  /**
   * Move one or both endpoints of an existing connection: rewrite the business
   * object's `sourceRef`/`targetRef` (and the endpoints' `outgoing`/`incoming`
   * reference lists for a sequence flow), re-wire the scene's own endpoint lists,
   * optionally replace the waypoints (a re-route — see `routing/orthogonal.ts`),
   * write the DI and fire once for the whole rewire.
   *
   * The connection keeps its container: a reconnect that would move a flow into a
   * different sub-process is rejected upstream by `rules.canReconnect`, which only
   * allows endpoints sharing one container.
   */
  reconnect(edge: SceneEdge, ends: ReconnectEnds, waypoints?: Point[]): SceneElement[] {
    const changed: SceneElement[] = [edge];
    const isSequenceFlow = isBpmnSubtypeOf(edge.type, 'bpmn:SequenceFlow');
    const track = (node: SceneNode | undefined): void => {
      if (node && !changed.includes(node)) changed.push(node);
    };

    if (ends.source && ends.source !== edge.source) {
      const previous = edge.source;
      if (previous) {
        previous.outgoing = previous.outgoing.filter((e) => e !== edge);
        if (isSequenceFlow) pullFrom(previous.businessObject, 'outgoing', edge.businessObject);
      }
      edge.source = ends.source;
      if (!ends.source.outgoing.includes(edge)) ends.source.outgoing.push(edge);
      setRef(edge.businessObject, 'sourceRef', ends.source.businessObject);
      if (isSequenceFlow) pushInto(ends.source.businessObject, 'outgoing', edge.businessObject);
      track(previous);
      track(ends.source);
    }

    if (ends.target && ends.target !== edge.target) {
      const previous = edge.target;
      if (previous) {
        previous.incoming = previous.incoming.filter((e) => e !== edge);
        if (isSequenceFlow) pullFrom(previous.businessObject, 'incoming', edge.businessObject);
      }
      edge.target = ends.target;
      if (!ends.target.incoming.includes(edge)) ends.target.incoming.push(edge);
      setRef(edge.businessObject, 'targetRef', ends.target.businessObject);
      if (isSequenceFlow) pushInto(ends.target.businessObject, 'incoming', edge.businessObject);
      track(previous);
      track(ends.target);
    }

    if (waypoints) edge.waypoints = waypoints.map((p) => ({ x: p.x, y: p.y }));
    syncEdgeWaypointsToDi(edge);
    this.finish(changed);
    return changed;
  }

  /** File a created shape's business object under the right container property. */
  private fileBusinessObject(
    bo: ModdleObject,
    type: string,
    owner: ModdleObject,
    factory: ModdleFactory | undefined,
  ): void {
    if (type === 'bpmn:Lane') {
      const laneSet = asModdle((prop(owner, 'laneSets') as ModdleObject[] | undefined)?.[0])
        ?? this.createLaneSet(owner, factory);
      setParent(bo, laneSet);
      pushInto(laneSet, 'lanes', bo);
      return;
    }
    if (type === 'bpmn:Participant') {
      // A pool depicts a process; mint the one it points at so the document stays
      // structurally valid (the process is a root element of the definitions).
      if (!asModdle(prop(bo, 'processRef'))) {
        const definitions = definitionsOf(this.scene);
        const process = mint(factory, 'bpmn:Process', {
          id: this.idGenerator.next('bpmn:Process'),
          isExecutable: false,
        });
        if (definitions) {
          setParent(process, definitions);
          pushInto(definitions, 'rootElements', process);
        }
        setRef(bo, 'processRef', process);
      }
    }
    setParent(bo, owner);
    pushInto(owner, containmentPropertyFor(type), bo);
  }

  /** Mint (and file) the `bpmn:LaneSet` a first lane needs. */
  private createLaneSet(owner: ModdleObject, factory: ModdleFactory | undefined): ModdleObject {
    const laneSet = mint(factory, 'bpmn:LaneSet', { id: this.idGenerator.next('bpmn:LaneSet') });
    setParent(laneSet, owner);
    pushInto(owner, 'laneSets', laneSet);
    return laneSet;
  }

  /** File a created connection's business object under the right container property. */
  private fileConnection(
    bo: ModdleObject,
    type: string,
    source: SceneNode,
    target: SceneNode,
    plane: Plane,
  ): void {
    if (isBpmnSubtypeOf(type, 'bpmn:MessageFlow')) {
      const collaboration = collaborationOf(this.scene, plane);
      if (collaboration) {
        setParent(bo, collaboration);
        pushInto(collaboration, 'messageFlows', bo);
        return;
      }
    }
    if (type === 'bpmn:DataInputAssociation') {
      // Data associations hang off the activity, not off the container.
      setParent(bo, target.businessObject);
      pushInto(target.businessObject, 'dataInputAssociations', bo);
      return;
    }
    if (type === 'bpmn:DataOutputAssociation') {
      setParent(bo, source.businessObject);
      pushInto(source.businessObject, 'dataOutputAssociations', bo);
      return;
    }
    const { owner } = flowContainerOf(source.parent ?? target.parent, plane);
    setParent(bo, owner);
    pushInto(owner, containmentPropertyFor(type), bo);
  }

  /** A free DI id for `elementId`, keeping the conventional `<id>_di` shape. */
  private diIdFor(elementId: string): string {
    const candidate = `${elementId}_di`;
    if (!this.idGenerator.assigned(candidate)) {
      this.idGenerator.claim(candidate);
      return candidate;
    }
    return this.idGenerator.nextPrefixed(`${elementId}_di_`);
  }

  private finish(elements: SceneElement[]): void {
    this.scene.revision += 1;
    for (const element of elements) {
      this.bus.fire<ElementChangedEvent>('element.changed', { element });
    }
    if (elements.length > 1) {
      this.bus.fire<ElementsChangedEvent>('elements.changed', { elements: elements.slice() });
    }
  }
}
