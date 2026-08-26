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

import type { EventBus } from '@canvas/events/bus.ts';
import type {
  ModdleObject,
  Point,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';

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

/** The moddle factory that minted `target` (`$model`), if any. */
function modelOf(target: ModdleObject | undefined): { create?: (type: string, props: object) => ModdleObject } | undefined {
  const model = (target as { $model?: unknown } | undefined)?.$model;
  return model && typeof model === 'object' ? (model as { create?: (t: string, p: object) => ModdleObject }) : undefined;
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

/**
 * Applies scene geometry edits through to the DI moddle objects, bumping the scene
 * revision and firing `element.changed` / `elements.changed`. Constructed with the
 * live {@link Scene} and {@link EventBus} the canvas owns.
 */
export class Writeback {
  private readonly scene: Scene;
  private readonly bus: EventBus;

  constructor(scene: Scene, bus: EventBus) {
    this.scene = scene;
    this.bus = bus;
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
