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
 * design §4) and fires `ElementChanged` / `ElementsChanged` on the bus.
 */

import { getDefaults, getExtensionType, StudyflowElement } from '@core/element/index.ts';
import { isBpmnSubtypeOf } from '@core/notation/bpmn.ts';

import type { EventBus } from '@core/events/bus.ts';
import {
  applyBandName,
  applyInitiator,
  isChoreographyTask,
  readChoreographyBands,
  tasksReferencing,
  type ParticipantBand,
} from '@canvas/model/choreography.ts';
import { applyColors, normalizeColors, type ElementColors } from '@canvas/model/color.ts';
import {
  dataAssociationEnds,
  isDataAssociationType,
  typeForDirection,
  wireDataAssociation,
} from '@canvas/model/dataAssociation.ts';
import {
  applyExpanded,
  applyMarkerVisible,
  contentsOf,
  EXPANDED_CONTENT_PADDING,
  frameAround,
  crossingEdgesOf,
  incidentEdgesOf,
  isCollapsed,
  isExpandable,
  nestedPlanesOf,
  rememberIncidentRouting,
  restoreIncidentRouting,
  samePoints,
  type SetExpandedOptions,
} from '@canvas/model/expand.ts';
import { IdGenerator } from '@canvas/model/ids.ts';
import {
  asModdle,
  definitionsAbove,
  mint,
  modelOf,
  parentOf,
  prop,
  pullFrom,
  pushInto,
  setParent,
  setProp,
  setRef,
  unfile,
  type ModdleFactory,
} from '@canvas/model/moddle.ts';
import { deleteElements as removeFromScene, type DeleteResult } from '@canvas/model/remove.ts';
import type {
  Bounds,
  ModdleObject,
  Plane,
  Point,
  Scene,
  SceneEdge,
  SceneElement,
  SceneLabel,
  SceneNode,
} from '@canvas/model/scene.ts';
import { labelIdOf } from '@canvas/render/labels.ts';
import { cropPoint } from '@canvas/routing/crop.ts';
import { orthogonalize, rerouteEdge } from '@canvas/routing/orthogonal.ts';
import { containerFor } from '@canvas/rules/rules.ts';
import { planeOf } from '@canvas/view/plane.ts';
import { sceneBounds } from '@canvas/view/viewport.ts';

/** Payload for the `ElementChanged` event (one element edited). */
export interface ElementChangedEvent {
  element: SceneElement;
}

/** Payload for the `ElementsChanged` event (a batch edited together). */
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
/** The `bpmndi:BPMNDiagram`/`bpmndi:BPMNPlane` pair a nested plane is made of. */
const DIAGRAM_DI_TYPE = 'bpmndi:BPMNDiagram';
const PLANE_DI_TYPE = 'bpmndi:BPMNPlane';
/** The `bpmndi:BPMNLabel` that carries an external label's own `dc:Bounds`. */
const LABEL_DI_TYPE = 'bpmndi:BPMNLabel';

// --- moddle access ----------------------------------------------------------
// The readers/writers/minters live in `model/moddle.ts`, so every module that
// mutates the live tree shares one set of cardinality-aware primitives.

/** The `bpmn:Definitions` root reachable from a scene's root plane, if any. */
export function definitionsOf(scene: Scene): ModdleObject | undefined {
  return definitionsAbove(scene.rootPlane.di);
}

// --- containment resolution -------------------------------------------------

/**
 * The node a NESTED plane depicts — the sub-process (or sub-choreography) you drill
 * into to reach it. `undefined` for the root plane, whose business object is the
 * process/collaboration itself and therefore has no shape.
 *
 * `view/plane.ts planeOwner` answers the same question for the view layer; this is
 * the model-side copy, kept here so `model/` does not import from `view/`.
 */
export function ownerNodeOf(scene: Scene, plane: Plane): SceneNode | undefined {
  if (plane === scene.rootPlane) return undefined;
  const element = scene.byBusinessObject.get(plane.businessObject);
  return element && element.kind === 'node' ? element : undefined;
}

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

/**
 * Padding a promoted pool leaves around the contents it adopts, and the width of
 * its vertical name band — `HORIZONTAL_PARTICIPANT_PADDING`,
 * `VERTICAL_PARTICIPANT_PADDING` and `PARTICIPANT_BORDER_WIDTH` from bpmn-js's
 * `CreateParticipantBehavior`, so a promoted pool keeps the slack the shipped
 * documents were drawn with.
 */
const PARTICIPANT_PADDING = { horizontal: 20, vertical: 20, band: 30 };

/**
 * Bounds for a pool that must enclose `contents`, never smaller than the footprint
 * the drop already gave it (`getParticipantBounds`). With nothing to enclose, the
 * drop's own bounds stand. The band is on the LEFT, so extra width grows rightwards
 * while extra height is shared evenly.
 */
function participantBoundsAround(dropped: Bounds, contents: readonly SceneElement[]): Bounds {
  const box = boundsAround(contents);
  if (!box) return dropped;
  const width = Math.max(dropped.width, box.width + PARTICIPANT_PADDING.horizontal * 2 + PARTICIPANT_PADDING.band);
  const height = Math.max(dropped.height, box.height + PARTICIPANT_PADDING.vertical * 2);
  return {
    x: box.x - PARTICIPANT_PADDING.horizontal - PARTICIPANT_PADDING.band,
    y: box.y + box.height / 2 - height / 2,
    width,
    height,
  };
}

/**
 * The box enclosing every node footprint and edge waypoint in `elements` —
 * {@link sceneBounds} (the accumulator `zoomToFit` uses) with an empty answer of
 * `undefined` instead of its "show me the origin" fallback box.
 */
function boundsAround(elements: readonly SceneElement[]): Bounds | undefined {
  const encloses = elements.some((el) => el.kind === 'node' || el.waypoints.length > 0);
  return encloses ? sceneBounds(elements) : undefined;
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
 * The SCENE-side label of `owner`, minted at `bounds` when the document carries
 * none — the first half of "a label a user has moved has a position of its own".
 *
 * A label the importer never saw has no {@link SceneLabel} at all: its position is
 * DERIVED from the owner by `render/labels.ts`, which is exactly why it cannot be
 * dragged. Seeding one at the box the renderer is currently drawing makes the label
 * explicit without moving it by a pixel, so the first frame of a label drag starts
 * from where the caption already is.
 *
 * Scene only: no `bpmndi:BPMNLabel` is minted here, nothing is written to the DI, no
 * revision is bumped. A gesture that is abandoned drops the label again
 * (`interaction/drag.ts` `cancel`) and the document never learns it existed.
 */
export function ensureSceneLabel(owner: SceneElement, bounds: Bounds): SceneLabel {
  const existing = owner.label;
  if (existing) {
    if (existing.x === undefined) existing.x = bounds.x;
    if (existing.y === undefined) existing.y = bounds.y;
    if (existing.width === undefined) existing.width = bounds.width;
    if (existing.height === undefined) existing.height = bounds.height;
    return existing;
  }
  const label: SceneLabel = {
    id: labelIdOf(owner),
    kind: 'label',
    businessObject: owner.businessObject,
    owner,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
  owner.label = label;
  return label;
}

/**
 * Drop a {@link SceneLabel} that {@link ensureSceneLabel} minted and the DI never
 * learned about (an abandoned label drag). A label the document DOES carry — one
 * with a backing `bpmndi:BPMNLabel` — is left alone; forgetting that one would
 * detach a caption the file positions.
 */
export function dropSceneLabel(owner: SceneElement): void {
  if (owner.label && !owner.label.di) delete owner.label;
}

/**
 * Ensure `owner`'s DI carries a `bpmndi:BPMNLabel` for its external label, minting
 * one through the DI object's own `$model` when it does not — bpmn-js's
 * `LabelBehavior` does the same the moment a label acquires a position or a name.
 * The `dc:Bounds` inside it is left to {@link syncLabelBoundsToDi}. Scene → DI only.
 */
function ensureLabelDi(owner: SceneElement): void {
  const label = owner.label;
  const di = owner.di;
  if (!label || label.di || !di) return;
  const labelDi = mint(modelOf(di), LABEL_DI_TYPE, {});
  (labelDi as { $parent?: unknown }).$parent = di;
  setProp(di, 'label', labelDi);
  label.di = labelDi;
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

/**
 * Re-dock every edge incident to `node` against its NEW outline, in the SCENE only.
 *
 * {@link dockConnectedEdges} is a pure *translation* helper — it shifts a docking
 * waypoint by the delta the node moved and bows out when that delta is zero. An
 * expand/collapse keeps the top-left corner and changes only the WIDTH and HEIGHT,
 * so the delta is always zero and nothing was ever re-docked: a collapsed
 * sub-process's flows kept aiming at the 350×200 frame that had just become 100×80,
 * starting inside the box or docking well off-centre. This is the resize path's
 * behaviour (`interaction/drag.ts applyResize`) applied to that outline change:
 *
 * - a route with no author bendpoints (≤ 2 waypoints) is re-cut wholesale by the
 *   orthogonal router, which crops both ends to the shapes it connects;
 * - a route the author bent is only RE-DOCKED — the docked end is projected onto the
 *   new outline and the run is squared — so the interior bends survive.
 *
 * Only `node`'s own edges are touched, never `edgesAffectedBy`, which descends into
 * the container's children and would re-route the whole interior.
 *
 * Returns the edges whose waypoints actually moved; the caller writes their DI.
 */
export function redockToOutline(node: SceneNode): SceneEdge[] {
  const changed: SceneEdge[] = [];
  for (const edge of incidentEdgesOf(node)) {
    const before = edge.waypoints.map((p) => ({ x: p.x, y: p.y }));
    if (edge.waypoints.length <= 2) {
      // Dangling (no source or target)? `rerouteEdge` says so and leaves it alone.
      rerouteEdge(edge);
    } else {
      const points = edge.waypoints.map((p) => ({ x: p.x, y: p.y }));
      const last = points.length - 1;
      // A self-loop names this node at BOTH ends; both are cropped in the one pass.
      if (edge.source === node) points[0] = cropPoint(node, points[1]);
      if (edge.target === node) points[last] = cropPoint(node, points[last - 1]);
      // No elbow-growing: a run the author bent diagonal stays diagonal.
      edge.waypoints = orthogonalize(points, undefined, false);
    }
    if (!samePoints(before, edge.waypoints)) changed.push(edge);
  }
  return changed;
}

/**
 * Re-route every edge crossing `node`'s boundary, in the SCENE only — the collapse /
 * expand counterpart of {@link redockToOutline}. `routeEdge` picks the end that is on
 * screen (`model/expand.ts visibleEndpointOf`), so this is what moves a flow onto the
 * closed frame and back onto the inner shape when it opens.
 *
 * Author bendpoints are NOT preserved here the way `redockToOutline` preserves them:
 * the two ends are different shapes in the two states, and the interior bends of a
 * route drawn to one of them mean nothing for the other. A collapse+expand round trip
 * still puts the original route back verbatim, from the parked snapshot
 * (`model/expand.ts restoreIncidentRouting`).
 *
 * Returns the edges whose waypoints actually moved; the caller writes their DI.
 */
export function rerouteCrossing(scene: Scene, node: SceneNode): SceneEdge[] {
  const changed: SceneEdge[] = [];
  for (const edge of crossingEdgesOf(scene, node)) if (rerouteEdge(edge)) changed.push(edge);
  return changed;
}

// --- nested-plane inlining (the expand half of design §1 "Nested planes") ----

/** One content element's geometry, exactly as the document filed it. */
interface ParkedGeometry {
  element: SceneElement;
  bounds?: Bounds;
  waypoints?: Point[];
  label?: { x?: number; y?: number };
}

/**
 * A nested plane taken out of the document while its container is drawn expanded,
 * with everything needed to put it back EXACTLY as it was — the plane's slot in
 * `Scene.planes`, its `BPMNDiagram`'s slot in `definitions.diagrams`, its
 * `planeElement` list in document order, and the untranslated geometry of every
 * element it held.
 */
interface ParkedPlane {
  plane: Plane;
  planeIndex: number;
  diagram?: ModdleObject;
  diagramIndex: number;
  definitions?: ModdleObject;
  planeElements: ModdleObject[];
  geometry: ParkedGeometry[];
  /** Translation the inline applied — undone for elements ADDED while expanded. */
  delta: Point;
}

/** Parked per DI shape, so a re-import simply starts with nothing parked. */
const parkedPlanes = new WeakMap<object, ParkedPlane>();

/** The parking key for a node — its DI shape when it has one, else the node itself. */
function parkKey(node: SceneNode): object {
  return node.di ?? node;
}

/** The `planeElement` list of a `bpmndi:BPMNPlane`, as a live array. */
function planeElementsOf(planeDi: ModdleObject): ModdleObject[] {
  const list = prop(planeDi, 'planeElement');
  return Array.isArray(list) ? (list as ModdleObject[]) : [];
}

/**
 * The nested plane an EXPAND of `node` should inline, or `undefined` when there is
 * nothing to inline: the node is not opening, owns no plane of its own, or owns one
 * that is still empty (a freshly authored container — there are no coordinates to
 * re-base, and unfiling its `BPMNDiagram` would only churn the document).
 */
function inlinablePlaneOf(scene: Scene, node: SceneNode): Plane | undefined {
  if (!isCollapsed(node)) return undefined;
  const plane = nestedPlanesOf(scene, node)[0];
  if (!plane) return undefined;
  return planeElementsOf(plane.di).length > 0 ? plane : undefined;
}

/** Snapshot `element`'s geometry so a collapse can put it back verbatim. */
function parkGeometry(element: SceneElement): ParkedGeometry {
  const parked: ParkedGeometry = { element };
  if (element.kind === 'node') {
    parked.bounds = { x: element.x, y: element.y, width: element.width, height: element.height };
  } else {
    parked.waypoints = element.waypoints.map((p) => ({ x: p.x, y: p.y }));
  }
  const label = element.label;
  if (label) parked.label = { ...(label.x !== undefined ? { x: label.x } : {}), ...(label.y !== undefined ? { y: label.y } : {}) };
  return parked;
}

/** Move `element` by `(dx, dy)` — scene, label and backing DI. */
function translateElement(element: SceneElement, dx: number, dy: number): void {
  if (element.kind === 'node') {
    element.x += dx;
    element.y += dy;
    translateLabel(element, dx, dy);
    syncNodeBoundsToDi(element);
  } else {
    element.waypoints = element.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    translateLabel(element, dx, dy);
    syncEdgeWaypointsToDi(element);
  }
}

/** Put a parked element back where the document had it — scene, label and DI. */
function restoreGeometry(parked: ParkedGeometry): void {
  const element = parked.element;
  if (element.kind === 'node' && parked.bounds) {
    element.x = parked.bounds.x;
    element.y = parked.bounds.y;
    element.width = parked.bounds.width;
    element.height = parked.bounds.height;
  } else if (element.kind === 'edge' && parked.waypoints) {
    element.waypoints = parked.waypoints.map((p) => ({ x: p.x, y: p.y }));
  }
  const label = element.label;
  if (label && parked.label) {
    if (parked.label.x !== undefined) label.x = parked.label.x;
    if (parked.label.y !== undefined) label.y = parked.label.y;
  }
  if (element.kind === 'node') syncNodeBoundsToDi(element);
  else syncEdgeWaypointsToDi(element);
}

/**
 * Take `element` out of its current spot in the scene tree: its parent's child
 * list and, when it is listed as one of `plane`'s top-level elements, that list
 * too. The element's `parent` field is the caller's to rewrite.
 */
function unlinkFromTree(element: SceneElement, plane: Plane): void {
  const siblings = element.parent?.children;
  if (siblings) {
    const at = siblings.indexOf(element);
    if (at >= 0) siblings.splice(at, 1);
  }
  const top = plane.children.indexOf(element);
  if (top >= 0) plane.children.splice(top, 1);
}

// --- committing API ---------------------------------------------------------

/** What {@link Writeback.addShape} needs to mint a business object + `BPMNShape` pair. */
export interface AddShapeSpec {
  /** The BPMN type to mint (`'bpmn:Task'`). Ignored when {@link AddShapeSpec.businessObject} is given. */
  type: string;
  /** Where the shape lands, in diagram coordinates. */
  bounds: Bounds;
  /** A pre-built business object (the app's palette builds one; see `model/build.ts`). */
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
  /**
   * Give an expandable container its own (empty) nested plane
   * ({@link Writeback.addNestedPlane}). Defaults to `true` for a container created
   * COLLAPSED (`isExpanded === false`), because a collapsed sub-process with no plane
   * of its own is a box with no way in: nothing can be drawn inside it, and
   * `view/plane.ts isDrillable` — which needs a nested plane — never offers the
   * drill-down. Pass `false` to mint the shape alone.
   */
  nestedPlane?: boolean;
}

/** What {@link Writeback.addConnection} needs to mint a flow + `BPMNEdge` pair. */
export interface AddConnectionSpec {
  /** The BPMN type to mint (`'bpmn:SequenceFlow'`, `'bpmn:MessageFlow'`, `'bpmn:Association'`, …). */
  type: string;
  /**
   * The end the connection leaves. A **connection** is legal here for exactly one
   * case, and it is the case ux-spec §4 records: a `bpmn:Association` reaching a
   * text annotation that hangs off a sequence flow. BPMN allows it (`sourceRef` is
   * a `bpmn:BaseElement`), and `model/import.ts` already reads such a document —
   * it resolves only the ends that are SHAPES ({@link resolveEndpoints}'s
   * `asNode`), so the scene link is left undefined and the edge is drawn from its
   * DI waypoints. Creating one takes the same shape, so what the canvas writes and
   * what it re-imports agree.
   */
  source: SceneNode | SceneEdge;
  target: SceneNode;
  /** Routed (and cropped) waypoints — see `routing/orthogonal.ts` `route`. */
  waypoints?: Point[];
  businessObject?: ModdleObject;
  attrs?: Record<string, unknown>;
  extensionType?: string;
  plane?: Plane;
  id?: string;
}

/** What {@link Writeback.addDataAssociation} needs; the direction is derived. */
export interface AddDataAssociationSpec {
  /** The end the association is drawn from — a data shape, or the activity. */
  source: SceneNode;
  /** The end the association is drawn to — the activity, or a data shape. */
  target: SceneNode;
  /** Routed (and cropped) waypoints — see `routing/orthogonal.ts` `route`. */
  waypoints?: Point[];
  /** The plane the `BPMNEdge` is filed in. Defaults to the scene's root plane. */
  plane?: Plane;
  /** Explicit id; minted from {@link IdGenerator} when absent. */
  id?: string;
}

/** What {@link Writeback.setExpanded} wrote, and what the caller must re-draw. */
export interface ExpandedResult {
  /** Elements whose geometry/flags changed (the node, then any followed edges). */
  changed: SceneElement[];
  /** The contents whose visibility follows the container — hidden or revealed. */
  contents: SceneElement[];
}

/** The endpoints a {@link Writeback.reconnect} rewrites; omit one to keep it. */
export interface ReconnectEnds {
  source?: SceneNode;
  target?: SceneNode;
}

/**
 * Applies scene geometry edits through to the DI moddle objects, bumping the scene
 * revision and firing `ElementChanged` / `ElementsChanged`. Constructed with the
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
    const changed: SceneElement[] = [node, ...this.applyBounds(node, bounds)];
    this.finish(changed);
    return changed;
  }

  /**
   * Move/resize `node` and write the DI **without** bumping the revision or firing —
   * the shared body of {@link Writeback.setNodeBounds} and {@link Writeback.setExpanded},
   * so a toggle that resizes a sub-process stays one revision and one event batch.
   * Returns the edges whose docking waypoints followed.
   */
  private applyBounds(node: SceneNode, bounds: PartialBounds): SceneEdge[] {
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
    return edges;
  }

  // --- DI flags (design §1 "expand/collapse subprocess", "gateway marker") ---

  /**
   * Expand or collapse a sub-process (or a choreography container): write
   * `BPMNShape.isExpanded` on the live DI object, resize the shape to match — the
   * plain activity box when collapsed, the footprint it had before when expanded
   * again — and report the contents whose visibility just changed so the caller can
   * re-draw them (`model/expand.ts`).
   *
   * Collapsing **hides**; it never deletes. Every contained business object stays in
   * `flowElements`, so a collapse+expand round-trips to a structurally identical
   * document. A container that owns a NESTED plane is the one case where the DI does
   * move: expanding inlines that plane into the parent one and re-bases its contents
   * rigidly into the new frame ({@link Writeback.inlineNestedPlane}), because the
   * plane's own coordinate space has nothing to do with the frame's; collapsing puts
   * the plane back verbatim from a parked snapshot.
   *
   * Because the toggle CHANGES THE OUTLINE, every incident edge is re-docked,
   * orthogonally re-routed and cropped against the new frame in the same breath
   * ({@link redockToOutline}) — before the single {@link Writeback.finish}, so the
   * geometry and the flag land in ONE revision bump and therefore one undo step. The
   * routing a state was left with is parked and restored on the way back
   * (`model/expand.ts restoreIncidentRouting`), which is what keeps a collapse+expand
   * byte-identical rather than silently re-cutting the document's own routes.
   *
   * Returns the changed elements (the node first, then any edges whose docking
   * followed the resize) — empty when the type cannot be expanded or nothing moved.
   */
  setExpanded(
    node: SceneNode,
    expanded: boolean,
    options: SetExpandedOptions = {},
  ): ExpandedResult {
    // Park the routing the CURRENT state is leaving behind, before anything moves.
    rememberIncidentRouting(this.scene, node);
    const flagChanged = (node.isExpanded !== false) !== expanded;
    const outline = { x: node.x, y: node.y, width: node.width, height: node.height };

    // A nested plane sizes the frame it is about to land in: fit the footprint to the
    // contents rather than taking the flat default that would crop them.
    //
    // `resize: false` means "flip the flag and nothing else", so it opts out of the
    // inlining too: re-basing an interior into a frame that is deliberately not being
    // resized would file it inside a 100×80 box.
    const inlinable = expanded && options.resize !== false
      ? inlinablePlaneOf(this.scene, node)
      : undefined;
    const contentBox = inlinable ? sceneBounds(contentsOf(this.scene, node)) : undefined;
    const settings: SetExpandedOptions = contentBox && options.bounds === undefined && options.resize !== false
      ? { ...options, bounds: frameAround(node, contentBox) }
      : options;

    const plan = applyExpanded(this.scene, node, expanded, settings);
    if (!plan.applied) return { changed: [], contents: plan.contents };
    const moved = plan.bounds ? this.applyBounds(node, plan.bounds) : [];
    if (inlinable && contentBox) this.inlineNestedPlane(node, inlinable, plan.contents, contentBox);
    else if (!expanded) this.restoreNestedPlane(node);

    // A flag-only write (a `BPMNShape` that merely omitted `isExpanded`) leaves the
    // frame exactly where it was, and an edge nobody's outline moved must not be
    // re-cut. Only a real change of outline re-docks.
    const resized = node.x !== outline.x || node.y !== outline.y
      || node.width !== outline.width || node.height !== outline.height;
    // A flow reaching INTO the container docks on whatever is on screen for its inner
    // end — the frame while it is closed, the shape itself once it opens — so the
    // toggle re-routes those too, even when the frame itself did not move.
    const redocked = restoreIncidentRouting(this.scene, node) ?? [
      ...(resized ? redockToOutline(node) : []),
      ...(flagChanged ? rerouteCrossing(this.scene, node) : []),
    ];
    for (const edge of redocked) syncEdgeWaypointsToDi(edge);

    const edges: SceneEdge[] = [...moved];
    for (const edge of redocked) if (!edges.includes(edge)) edges.push(edge);
    const changed: SceneElement[] = [node, ...edges];
    this.finish(changed);
    return { changed, contents: plan.contents };
  }

  /** Toggle `node`'s expanded state; see {@link Writeback.setExpanded}. */
  toggleExpanded(node: SceneNode, options: SetExpandedOptions = {}): ExpandedResult {
    return this.setExpanded(node, node.isExpanded === false, options);
  }

  /**
   * Inline the nested plane `plane` into the plane `node` is drawn in: re-base its
   * contents rigidly into `node`'s new frame and move their `planeElement` entries up
   * into the parent plane, leaving the container in exactly the shape an
   * *inline-expanded* sub-process already has (`model/import.ts` files such children
   * under the parent plane and parents them under the sub-process).
   *
   * Why this is not optional. A nested plane's contents live in their own coordinate
   * space — `sklearn_pipeline` draws `select_model` at 1204,230 and its
   * `build_pipeline` child at 256,160 — so revealing them in place would scatter the
   * interior a thousand units from the frame that is supposed to hold it. bpmn-js
   * does the same re-base in `SubProcessPlaneBehavior`.
   *
   * Only a single TRANSLATION is applied, so the interior's relative layout is
   * preserved bit for bit, and the original geometry, the plane's slot in
   * `Scene.planes`, the `BPMNDiagram`'s slot in `definitions.diagrams` and the
   * `planeElement` order are all parked so {@link Writeback.restoreNestedPlane} can
   * put the document back byte-identically on the way out.
   */
  private inlineNestedPlane(
    node: SceneNode,
    plane: Plane,
    contents: SceneElement[],
    contentBox: Bounds,
  ): void {
    const scene = this.scene;
    const parentPlane = planeOf(scene, node);
    const planeElements = [...planeElementsOf(plane.di)];
    const diagram = parentOf(plane.di);
    const definitions = definitionsOf(scene);
    const diagrams = definitions && Array.isArray(prop(definitions, 'diagrams'))
      ? (prop(definitions, 'diagrams') as ModdleObject[])
      : [];

    const pad = EXPANDED_CONTENT_PADDING;
    const dx = node.x + pad.left - contentBox.x;
    const dy = node.y + pad.top - contentBox.y;

    const parked: ParkedPlane = {
      plane,
      planeIndex: scene.planes.indexOf(plane),
      diagramIndex: diagram ? diagrams.indexOf(diagram) : -1,
      planeElements,
      geometry: contents.map(parkGeometry),
      delta: { x: dx, y: dy },
      ...(diagram ? { diagram } : {}),
      ...(definitions ? { definitions } : {}),
    };
    // Risk 10 of the plan: a document whose nested plane already holds coordinates
    // inside the frame must not be shifted at all.
    if (dx !== 0 || dy !== 0) for (const element of contents) translateElement(element, dx, dy);

    for (const di of planeElements) {
      pullFrom(plane.di, 'planeElement', di);
      pushInto(parentPlane.di, 'planeElement', di);
      setParent(di, parentPlane.di);
    }
    if (parked.planeIndex >= 0) scene.planes.splice(parked.planeIndex, 1);
    if (diagram && definitions) pullFrom(definitions, 'diagrams', diagram);

    parkedPlanes.set(parkKey(node), parked);
  }

  /**
   * Put back the plane {@link Writeback.inlineNestedPlane} took out — the same
   * `BPMNDiagram` object, in the same slot, holding the same `planeElement` list in
   * the same order, with every content element back at the coordinates the document
   * gave it. Restoring from a snapshot rather than translating by `-delta` is what
   * makes the round trip byte-identical rather than merely close.
   */
  private restoreNestedPlane(node: SceneNode): void {
    const key = parkKey(node);
    const parked = parkedPlanes.get(key);
    if (parked) {
      parkedPlanes.delete(key);

      const scene = this.scene;
      const parentPlane = planeOf(scene, node);
      for (const di of parked.planeElements) {
        pullFrom(parentPlane.di, 'planeElement', di);
        setParent(di, parked.plane.di);
      }
      // The whole list at once, so document order comes back exactly as it left.
      setProp(parked.plane.di, 'planeElement', parked.planeElements);

      for (const geometry of parked.geometry) restoreGeometry(geometry);

      if (parked.diagram && parked.definitions) {
        const diagrams = prop(parked.definitions, 'diagrams');
        if (Array.isArray(diagrams)) {
          const at = parked.diagramIndex >= 0 ? Math.min(parked.diagramIndex, diagrams.length) : diagrams.length;
          if (!diagrams.includes(parked.diagram)) diagrams.splice(at, 0, parked.diagram);
        } else {
          setProp(parked.definitions, 'diagrams', [parked.diagram]);
        }
      }
      if (!scene.planes.includes(parked.plane)) {
        const at = parked.planeIndex >= 0 ? Math.min(parked.planeIndex, scene.planes.length) : scene.planes.length;
        scene.planes.splice(at, 0, parked.plane);
      }
    }
    this.adoptInlineContents(node, parked?.delta);
  }

  /**
   * File into `node`'s own nested plane any content whose DI still sits in the
   * PARENT plane — an element authored while the container was drawn expanded had
   * its `BPMNShape` filed in the plane on screen, and without this a drill-down
   * after the collapse opens the nested plane and finds none of it. `delta` is the
   * translation the expand applied ({@link Writeback.inlineNestedPlane}); undoing
   * it puts an adopted element in the same coordinate space as the plane's own
   * restored contents. Runs on every collapse; with no nested plane, or nothing
   * inline, it is a no-op.
   */
  private adoptInlineContents(node: SceneNode, delta?: Point): void {
    const scene = this.scene;
    const plane = nestedPlanesOf(scene, node)[0];
    if (!plane) return;
    const parentPlane = planeOf(scene, node);
    for (const element of contentsOf(scene, node)) {
      const di = element.di;
      if (!di || !pullFrom(parentPlane.di, 'planeElement', di)) continue;
      pushInto(plane.di, 'planeElement', di);
      setParent(di, plane.di);
      if (delta && (delta.x !== 0 || delta.y !== 0)) translateElement(element, -delta.x, -delta.y);
      const at = parentPlane.children.indexOf(element);
      if (at >= 0) parentPlane.children.splice(at, 1);
      // A plane lists only its TOP-LEVEL elements — the container's direct children.
      if (element.parent === node && !plane.children.includes(element)) plane.children.push(element);
    }
  }

  /**
   * Show or hide a gateway's marker: write `BPMNShape.isMarkerVisible` on the live DI
   * object (the × of an exclusive gateway — design §2). Returns whether anything was
   * written; a no-op leaves the document and its serialization untouched.
   */
  setMarkerVisible(node: SceneNode, visible: boolean): boolean {
    if (!applyMarkerVisible(node, visible)) return false;
    this.finish([node]);
    return true;
  }

  /** Whether `node`'s type carries a meaningful `isExpanded` (`model/expand.ts`). */
  canExpand(node: SceneNode): boolean {
    return isExpandable(node.type);
  }

  /**
   * Write `name` onto a moddle object in place and report the edit as a change to
   * `elements`. `target` defaults to the first element's own business object (the
   * ordinary label edit); pass one explicitly to name an object a *different* set of
   * elements depicts, mirroring the modeler's
   * `modeling.updateModdleProperties(element, moddleElement, { name })`. That is what
   * {@link Writeback.setBandName} does with a choreography participant: one
   * `bpmn:Participant` is referenced by every choreography task it takes part in,
   * which is why `elements` is a list — one write, one revision bump,
   * `ElementChanged` for each depiction.
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
   * participant pair). Bumps the revision and fires `ElementChanged`.
   */
  touch(element: SceneElement): void {
    this.finish([element]);
  }

  // --- choreography bands (design §2, `model/choreography.ts`) --------------

  /**
   * Write a choreography participant band's text — the inverse of
   * `readChoreographyBands` (`@core/document/choreography.ts`). A band renders a
   * `bpmn:Participant`'s `name`, NOT the task's, so this writes the participant the
   * task references, minting the `[top, bottom]` pair (and, in a process-rooted
   * document, the `bpmn:Collaboration` that holds it) the first time a band is
   * edited.
   *
   * One participant is shared by every choreography task it takes part in, so a
   * rename invalidates a band on each of them: the whole set is returned (and gets
   * one `ElementChanged` each) for the caller to re-draw. Band *geometry* is
   * derived from the task's single `dc:Bounds` (`render/shapes.ts`
   * `choreographyBandHeight`) and is deliberately untouched — a rename cannot move a
   * band.
   *
   * Returns the elements to re-draw, or `[]` when nothing was written (same text, an
   * unchanged pair, or a non-choreography element).
   */
  setBandName(node: SceneNode, band: ParticipantBand, name: string): SceneElement[] {
    if (!isChoreographyTask(node)) return [];
    const write = applyBandName(node, band, name, this.idGenerator);
    if (!write) return [];
    if (!write.renamed && !write.minted) return [];
    const affected = tasksReferencing(this.scene, write.participant, node);
    this.finish(affected);
    return affected;
  }

  /**
   * Point a choreography task's `initiatingParticipantRef` at the participant of
   * `band` (which band is drawn as the initiating one — design §2). Mints the
   * participant pair if the task has none. Returns whether anything was written.
   */
  setInitiator(node: SceneNode, band: ParticipantBand): boolean {
    if (!isChoreographyTask(node)) return false;
    if (!applyInitiator(node, band, this.idGenerator)) return false;
    this.finish([node]);
    return true;
  }

  /** Flip which choreography band initiates ({@link Writeback.setInitiator}). */
  swapInitiator(node: SceneNode): boolean {
    if (!isChoreographyTask(node)) return false;
    const current = readChoreographyBands(node.businessObject).initiator;
    return this.setInitiator(node, current === 'top' ? 'bottom' : 'top');
  }

  // --- colour (design §1 "colour … → BO `di.fill`/`di.stroke` attrs") --------

  /**
   * Write `colors` onto each element's `bpmndi:BPMNShape`/`BPMNEdge` in the bpmn.io
   * colour extension — both the current (`color:background-color` /
   * `color:border-color`) and the legacy (`bioc:fill` / `bioc:stroke`) vocabulary,
   * exactly as the modeler's `mutate.setColor` path does (`model/color.ts`).
   *
   * A field left out of `colors` is untouched; a field present but falsy clears that
   * colour. A connection takes a stroke only. Returns the elements actually written
   * — a no-op writes nothing, bumps nothing, and fires nothing, so re-applying the
   * colour an element already has leaves the serialization byte-identical.
   *
   * The patch is normalized once *before* the first element is touched, so an
   * invalid colour throws with nothing half-written.
   */
  setColor(elements: SceneElement | readonly SceneElement[], colors: ElementColors): SceneElement[] {
    const list = Array.isArray(elements)
      ? (elements as readonly SceneElement[])
      : [elements as SceneElement];
    const patch = normalizeColors(colors);
    const changed = list.filter((element) => applyColors(element, patch));
    if (changed.length > 0) this.finish(changed);
    return changed;
  }

  /** Replace `edge`'s waypoints (scene + `di:waypoint`), bump the revision, fire. */
  setEdgeWaypoints(edge: SceneEdge, points: Point[]): void {
    edge.waypoints = points.map((p) => ({ x: p.x, y: p.y }));
    syncEdgeWaypointsToDi(edge);
    this.finish([edge]);
  }

  /**
   * Move an element's EXTERNAL LABEL to `bounds`, writing **only** its own
   * `bpmndi:BPMNLabel/dc:Bounds` (parity spec addendum 3 §5). The owner's
   * `dc:Bounds` and `di:waypoint` are deliberately untouched: a caption dragged off
   * its shape must not move the shape, and the round-trip diff of a label move is
   * one `<bpmndi:BPMNLabel>` and nothing else.
   *
   * Both halves are minted on demand — the {@link SceneLabel} (so the position stops
   * being derived from the owner) and the `bpmndi:BPMNLabel` + `dc:Bounds` under the
   * owner's `BPMNShape`/`BPMNEdge` (so it survives re-serialization). That is what
   * turns an unlabeled sequence flow's brand-new caption into a positioned label.
   *
   * `options.silent` applies the write without bumping the revision or firing, for a
   * caller that is about to make one of its own — the inline editor mints the label
   * and writes the name as ONE edit, which is one undo step, not two.
   *
   * Returns whether anything was written (an owner with no DI at all cannot carry a
   * label, and is left alone).
   */
  setLabelBounds(
    owner: SceneElement,
    bounds: Bounds,
    options: { silent?: boolean } = {},
  ): boolean {
    if (!owner.di) return false;
    const label = ensureSceneLabel(owner, bounds);
    label.x = bounds.x;
    label.y = bounds.y;
    label.width = bounds.width;
    label.height = bounds.height;
    // A minted label joins the scene index, exactly where `model/import.ts` files
    // the ones that came in with the document.
    this.scene.elementsById.set(label.id, label);
    ensureLabelDi(owner);
    syncLabelBoundsToDi(owner);
    if (!options.silent) this.finish([owner]);
    return true;
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

  // --- deletion (design §1 "delete → remove BO **and** planeElement") -------

  /**
   * Delete `elements` and everything that cannot survive them — a container's
   * descendants and nested-plane contents, attached boundary events, and every
   * incident edge — from the live moddle tree, its DI, and the scene
   * (`model/remove.ts`). Bumps the revision once and fires `ElementsRemoved`,
   * `ElementChanged` per touched survivor, and `ElementsChanged`.
   *
   * The scene half only: the caller owns the SVG (see `Canvas.deleteElements`).
   */
  deleteElements(elements: SceneElement | readonly SceneElement[]): DeleteResult {
    return removeFromScene(this.scene, this.bus, elements);
  }

  // --- containment (move drop onto another container) -----------------------

  /**
   * Re-home `nodes` (their contents come along through the scene tree) under
   * `parent` — `undefined` meaning the root of the plane they are drawn in — after
   * a move gesture dropped them onto a different container.
   *
   * Both halves move: the business object is refiled into the new container's
   * `flowElements`/`artifacts` (lane membership via `flowNodeRef`, resolved by
   * {@link flowContainerOf} exactly as a create is), and the scene tree is
   * re-linked. The DI `planeElement` stays where it is — a drop target is always
   * on the same plane the shape is drawn in.
   *
   * An incident edge follows `addConnection`'s rule — it lives in the container
   * both its ends share, else at the plane root — so any edge whose shared
   * container just changed is re-homed with them.
   */
  reparent(nodes: readonly SceneNode[], parent?: SceneNode): SceneElement[] {
    const scene = this.scene;
    const changed: SceneElement[] = [];
    for (const node of nodes) {
      if (node === parent || (node.parent ?? undefined) === parent) continue;
      const plane = planeOf(scene, node);
      const planeOwner = ownerNodeOf(scene, plane);
      const from = flowContainerOf(node.parent, plane);
      const to = flowContainerOf(parent, plane);
      const bo = node.businessObject;
      unfile(bo, [parentOf(bo), from.owner, from.lane]);
      this.fileBusinessObject(bo, node.type, to.owner, modelOf(bo) ?? modelOf(plane.di));
      if (to.lane && isBpmnSubtypeOf(node.type, 'bpmn:FlowNode')) pushInto(to.lane, 'flowNodeRef', bo);
      unlinkFromTree(node, plane);
      node.parent = parent;
      if (parent) parent.children.push(node);
      if (!parent || parent === planeOwner) plane.children.push(node);
      changed.push(node);
    }
    if (changed.length === 0) return [];

    const edges = new Set<SceneEdge>();
    for (const el of changed) {
      if (el.kind !== 'node') continue;
      for (const edge of [...el.incoming, ...el.outgoing]) edges.add(edge);
    }
    for (const edge of edges) {
      const plane = planeOf(scene, edge);
      const planeOwner = ownerNodeOf(scene, plane);
      const next = edge.source && edge.source.parent === edge.target?.parent
        ? edge.source.parent
        : undefined;
      if ((edge.parent ?? undefined) === next) continue;
      // Only a flow-container-owned edge is refiled; a data association lives on
      // its activity and a message flow on the collaboration, and both moved (or
      // stayed) with their owner already.
      if (edge.type === 'bpmn:SequenceFlow' || edge.type === 'bpmn:Association') {
        const bo = edge.businessObject;
        unfile(bo, [parentOf(bo)]);
        this.fileBusinessObject(bo, edge.type, flowContainerOf(next, plane).owner, modelOf(bo));
      }
      unlinkFromTree(edge, plane);
      edge.parent = next;
      if (next) next.children.push(edge);
      if (!next || next === planeOwner) plane.children.push(edge);
      changed.push(edge);
    }

    this.finish(changed);
    return changed;
  }

  // --- creation (design §1 "add shape" / "add edge") ------------------------

  /**
   * Create a shape: mint the business object into the drop target's container AND
   * the `bpmndi:BPMNShape` + `dc:Bounds` into the plane, then index the resulting
   * {@link SceneNode} in the scene, bump the revision and fire `ElementChanged`.
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
    // Dropped on the empty background of a NESTED plane, the container is the node
    // that plane depicts — the sub-process you drilled into — exactly as
    // `model/import.ts` (pass 3) parents a nested plane's own contents.
    const planeOwner = ownerNodeOf(scene, plane);
    const parentNode = spec.attachTo ? spec.attachTo.parent : (spec.parent ?? planeOwner);
    if (spec.attachTo) setRef(bo, 'attachedToRef', spec.attachTo.businessObject);

    // A pool has nowhere legal to live under a `bpmn:Process`, so dropping the first
    // one on a process root PROMOTES the root to a `bpmn:Collaboration` first. Must
    // run before `flowContainerOf`, which reads the plane's root business object.
    const promotion = type === 'bpmn:Participant' && !parentNode
      ? this.promoteRootToCollaboration(plane, bo, factory, spec.bounds)
      : undefined;
    const bounds = promotion?.bounds ?? spec.bounds;

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
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      children: [],
      incoming: [],
      outgoing: [],
    };
    if (spec.isExpanded !== undefined) node.isExpanded = spec.isExpanded;

    if (parentNode) {
      node.parent = parentNode;
      parentNode.children.push(node);
    }
    // Top-level *of this plane* is "no container, or the container the plane IS" —
    // the same test `model/import.ts` applies, and what `view/plane.ts planeOf`
    // reads to decide which plane an element is drawn in.
    if (!parentNode || parentNode === planeOwner) plane.children.push(node);
    // A promoted root hands its contents to the pool that promoted it: the pool was
    // sized to enclose them, and in the document they are already where they belong
    // (the pool's `processRef` IS the process that held them).
    if (promotion && promotion.adopt.length > 0) {
      for (const child of promotion.adopt) {
        const at = plane.children.indexOf(child);
        if (at >= 0) plane.children.splice(at, 1);
        child.parent = node;
        node.children.push(child);
      }
    }
    scene.elementsById.set(id, node);
    scene.byBusinessObject.set(bo, node);

    // A container created COLLAPSED gets the plane its contents will live in, so the
    // drill-down badge appears and the thing is authorable the moment it exists.
    if ((spec.nestedPlane ?? node.isExpanded === false) && isExpandable(type)) {
      this.addNestedPlane(node, factory);
    }

    // Mints the `dc:Bounds` the shape has none of yet, from the scene geometry.
    syncNodeBoundsToDi(node);
    this.finish([node]);
    return node;
  }

  /**
   * Give `node` a nested plane of its own: a fresh `bpmndi:BPMNDiagram` holding a
   * `bpmndi:BPMNPlane` whose `bpmnElement` is `node`'s business object, filed in
   * `definitions.diagrams` and indexed in `Scene.planes` — the second half of what
   * an authored sub-process needs (design §1 "Nested planes").
   *
   * This is what turns a collapsed container from a dead box into a place: with a
   * plane, `view/plane.ts` reports it {@link isDrillable} and draws the drill-down
   * badge, a double click enters it, and everything created while the cursor is
   * inside is filed into THIS plane and into the container's own `flowElements`.
   * Without one, a user who drops a sub-process has no way to put anything in it.
   *
   * Idempotent: a node that already owns a nested plane keeps the one it has. The
   * plane starts empty — no element is moved into it, so the document round-trips
   * with exactly one more (empty) `BPMNDiagram` and nothing else disturbed. Deleting
   * the node drops the diagram again (`model/remove.ts removePlane`, which finds it
   * through the plane DI's `$parent`).
   */
  addNestedPlane(node: SceneNode, factory?: ModdleFactory): Plane | undefined {
    const scene = this.scene;
    const existing = scene.planes.find(
      (plane) => plane !== scene.rootPlane && plane.businessObject === node.businessObject,
    );
    if (existing) return existing;

    const definitions = definitionsOf(scene);
    const model = factory
      ?? modelOf(scene.rootPlane.di)
      ?? modelOf(definitions)
      ?? modelOf(node.di)
      ?? modelOf(node.businessObject);

    const planeDi = mint(model, PLANE_DI_TYPE, {
      id: this.idGenerator.nextPrefixed('BPMNPlane_'),
      bpmnElement: node.businessObject,
    });
    const diagram = mint(model, DIAGRAM_DI_TYPE, {
      id: this.idGenerator.nextPrefixed('BPMNDiagram_'),
      plane: planeDi,
    });
    // `model/remove.ts` walks `plane.di.$parent` to find the diagram to unfile, so
    // the back-link is load-bearing, not decoration.
    setParent(planeDi, diagram);
    if (definitions) {
      setParent(diagram, definitions);
      pushInto(definitions, 'diagrams', diagram);
    }

    const plane: Plane = {
      id: typeof planeDi.id === 'string' ? planeDi.id : `${node.id}_plane`,
      businessObject: node.businessObject,
      di: planeDi,
      children: [],
    };
    scene.planes.push(plane);
    return plane;
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
   *
   * A **data association** is wired differently — its refs point at a data shape and
   * an io slot, and it is filed on the activity rather than in a container — so the
   * two data-association types are handed to `model/dataAssociation.ts`
   * ({@link Writeback.addDataAssociation}). That keeps the connect gesture, which
   * only knows the type the rules named, on the single correct path.
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

    const isDataAssociation = isDataAssociationType(type);
    const dataEnds = isDataAssociation && spec.source.kind === 'node'
      ? dataAssociationEnds(spec.source, spec.target)
      : undefined;
    if (isDataAssociation && !dataEnds) {
      // Unreachable through the rules, which only name these types for a pair that
      // sorts — so a direct caller asking for one that does not is a bug worth
      // hearing about, not a half-wired association silently left in the document.
      throw new Error(
        `${type} is not valid between ${spec.source.type} and ${spec.target.type}`,
      );
    }
    if (dataEnds) {
      wireDataAssociation(bo, dataEnds, this.idGenerator);
    } else {
      setRef(bo, 'sourceRef', spec.source.businessObject);
      setRef(bo, 'targetRef', spec.target.businessObject);
      if (isBpmnSubtypeOf(type, 'bpmn:SequenceFlow')) {
        pushInto(spec.source.businessObject, 'outgoing', bo);
        pushInto(spec.target.businessObject, 'incoming', bo);
      }
      this.fileConnection(bo, type, spec.source, spec.target, plane);
    }

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
      // A connection SOURCE stays out of the scene link (and out of its
      // `outgoing` list, which only a node has): `SceneEdge.source` is a node, and
      // an import of the very document this writes produces the same undefined.
      // `model/remove.ts` follows the moddle refs rather than the scene link, so
      // the association still goes when the flow it annotates does.
      ...(spec.source.kind === 'node' ? { source: spec.source } : {}),
      target: spec.target,
    };
    if (spec.source.kind === 'node') spec.source.outgoing.push(edge);
    spec.target.incoming.push(edge);

    // A connection is drawn in the container both its ends share; a cross-container
    // one (a message flow) belongs to the plane itself.
    const parentNode = spec.source.parent && spec.source.parent === spec.target.parent
      ? spec.source.parent
      : undefined;
    if (parentNode) {
      edge.parent = parentNode;
      parentNode.children.push(edge);
    }
    // …and it is a top-level element of THIS plane when it has no container, or when
    // its container is the very node the plane depicts (see `addShape`).
    if (!parentNode || parentNode === ownerNodeOf(scene, plane)) plane.children.push(edge);
    scene.elementsById.set(id, edge);
    scene.byBusinessObject.set(bo, edge);

    // Mints the `di:waypoint` list from the scene waypoints.
    syncEdgeWaypointsToDi(edge);
    this.finish([edge, spec.source, spec.target]);
    return edge;
  }

  /**
   * Create a data association between a data shape and an activity: the
   * `bpmn:DataInputAssociation` / `bpmn:DataOutputAssociation` business object
   * (filed on the *activity*, with its refs at the schema's own cardinality and its
   * `ioSpecification` slot minted when the activity declares one) AND the
   * `bpmndi:BPMNEdge` + `di:waypoint` list — see `model/dataAssociation.ts`.
   *
   * The direction is derived from which end is the data shape, so a caller only has
   * to pass the pair in the order it drew them. Returns `undefined` when the pair is
   * not one data shape and one non-data shape — exactly when the rules would have
   * refused it.
   */
  addDataAssociation(spec: AddDataAssociationSpec): SceneEdge | undefined {
    const ends = dataAssociationEnds(spec.source, spec.target);
    if (!ends) return undefined;
    return this.addConnection({
      type: typeForDirection(ends.direction),
      source: spec.source,
      target: spec.target,
      waypoints: spec.waypoints,
      plane: spec.plane,
      id: spec.id,
    });
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

  /**
   * Turn a `bpmn:Process` root into a `bpmn:Collaboration` so a pool can be dropped
   * on it — bpmn-js's `CreateParticipantBehavior` + `UpdateCanvasRootBehavior`
   * (`modeling.makeCollaboration()`), in the canvas's own terms.
   *
   * In the DOCUMENT almost nothing moves. The old process is neither discarded nor
   * re-parented: the new pool *depicts* it (`processRef`), so it stays a root element
   * of the definitions and everything it already holds keeps its container. Only
   * what the PLANE depicts changes — the collaboration instead of the process. BPMN
   * DI has no nesting either (a pool's contents are plane children of the
   * collaboration plane), so the shapes already filed need no rewriting.
   *
   * In the SCENE two things move, and they are what this returns. A pool that does
   * not enclose the elements whose process it now owns would re-import as a pool
   * standing beside its own contents, so:
   *
   * - the pool is sized and placed to wrap what is already drawn, by bpmn-js's own
   *   `getParticipantBounds` arithmetic. Where bpmn-js keeps the pool under the
   *   pointer and CONSTRAINS how far it may stray (`getParticipantCreateConstraints`),
   *   this ignores the drop point on a populated root: the drop decides that a pool
   *   arrives, not where. On an empty root the drop point stands as given.
   * - the plane's children become the pool's children (`adopt`), which the caller
   *   applies once the node exists.
   *
   * A no-op — `undefined` — on a root that is already a collaboration or choreography.
   */
  private promoteRootToCollaboration(
    plane: Plane,
    participant: ModdleObject,
    factory: ModdleFactory | undefined,
    dropped: Bounds,
  ): { bounds: Bounds; adopt: SceneElement[] } | undefined {
    const process = plane.businessObject;
    if (process.$type !== 'bpmn:Process') return undefined;

    const collaboration = mint(factory, 'bpmn:Collaboration', {
      id: this.idGenerator.next('bpmn:Collaboration'),
    });
    const definitions = definitionsOf(this.scene);
    if (definitions) {
      setParent(collaboration, definitions);
      pushInto(definitions, 'rootElements', collaboration);
    }

    // Claiming the process here is what stops `fileBusinessObject` minting a second,
    // empty one for the pool to point at.
    setRef(participant, 'processRef', process);

    plane.businessObject = collaboration;
    setRef(plane.di, 'bpmnElement', collaboration);

    const adopt = plane.children.slice();
    return { bounds: participantBoundsAround(dropped, adopt), adopt };
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
    source: SceneNode | SceneEdge,
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
    // Data associations never reach here — they hang off the activity, and
    // `addConnection` routes them to `model/dataAssociation.ts` before filing.
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
    // One event per element: a self-connection names the same node as both ends,
    // and a batch may list a container twice through two of its children.
    const touched = elements.length > 1 ? [...new Set(elements)] : elements;
    for (const element of touched) {
      this.bus.fire<ElementChangedEvent>('ElementChanged', { element });
    }
    if (touched.length > 1) {
      this.bus.fire<ElementsChangedEvent>('ElementsChanged', { elements: touched.slice() });
    }
  }
}
