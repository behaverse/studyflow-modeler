/**
 * Every committed edit of the document: writes the scene and the business objects,
 * bumps the revision and fires `ElementChanged` / `ElementsChanged`. DI is never
 * touched here; it is rebuilt from the scene on save (`model/di.ts`).
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
import { normalizeColors } from '@canvas/model/color.ts';
import {
  dataAssociationEnds,
  isDataAssociationType,
  typeForDirection,
  wireDataAssociation,
} from '@canvas/model/dataAssociation.ts';
import { IdGenerator } from '@canvas/model/ids.ts';
import { syncLabel } from '@canvas/model/labels.ts';
import {
  asModdle,
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
  ElementColors,
  ModdleObject,
  Point,
  Scene,
  SceneEdge,
  SceneElement,
  SceneLabel,
  SceneNode,
} from '@canvas/model/scene.ts';
import {
  boundsOf,
  COLLAPSED_SIZE,
  CONTENT_PADDING,
  contentsOf,
  crossingEdgesOf,
  EXPANDED_SIZE,
  frameAround,
  incidentEdgesOf,
  isExpandable,
} from '@canvas/model/tree.ts';
import { cropPoint } from '@canvas/routing/crop.ts';
import { orthogonalize, rerouteEdge } from '@canvas/routing/orthogonal.ts';
import { containerFor } from '@canvas/rules/rules.ts';

type Drawable = SceneNode | SceneEdge;

export interface PartialBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface FlowContainer {
  /** The business object that files the element (`bpmn:Process`, `bpmn:SubProcess`, `bpmn:Collaboration`). */
  owner: ModdleObject;
  /** The lane the element sits in, when the pool is divided into lanes. */
  lane?: ModdleObject;
}

/**
 * Where a shape dropped on `parent` is filed: a group hands over to its own
 * container, a lane claims by reference and hands over to the pool, a pool files
 * into its process, and nothing at all means the diagram root.
 */
export function flowContainerOf(parent: SceneNode | undefined, root: ModdleObject): FlowContainer {
  let lane: ModdleObject | undefined;
  let node = containerFor(parent) as SceneNode | undefined;
  const guard = new Set<SceneNode>();
  while (node && node.type === 'bpmn:Lane' && !guard.has(node)) {
    guard.add(node);
    lane ??= node.businessObject;
    node = containerFor(node.parent) as SceneNode | undefined;
  }
  let owner = node ? node.businessObject : root;
  if (node?.type === 'bpmn:Participant') owner = asModdle(prop(node.businessObject, 'processRef')) ?? owner;
  return lane ? { owner, lane } : { owner };
}

export function containmentPropertyFor(type: string): 'participants' | 'artifacts' | 'flowElements' {
  if (type === 'bpmn:Participant') return 'participants';
  if (isBpmnSubtypeOf(type, 'bpmn:Artifact')) return 'artifacts';
  return 'flowElements';
}

const PARTICIPANT_PADDING = { horizontal: 20, vertical: 20, band: 30 };

function participantBoundsAround(dropped: Bounds, contents: readonly SceneElement[]): Bounds {
  const box = boundsOf(contents);
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

function collaborationOf(scene: Scene): ModdleObject | undefined {
  if (scene.root.$type === 'bpmn:Collaboration') return scene.root;
  for (const candidate of scene.byBusinessObject.keys()) {
    const owner = parentOf(candidate);
    if (owner?.$type === 'bpmn:Collaboration') return owner;
  }
  return undefined;
}

/** Shift the docking waypoints of every edge on `node` by `(dx, dy)`. */
export function dockConnectedEdges(node: SceneNode, dx: number, dy: number): SceneEdge[] {
  if (dx === 0 && dy === 0) return [];
  const affected = new Set<SceneEdge>();
  for (const edge of node.outgoing) {
    if (edge.waypoints.length === 0) continue;
    const w = edge.waypoints[0];
    edge.waypoints[0] = { x: w.x + dx, y: w.y + dy };
    affected.add(edge);
  }
  for (const edge of node.incoming) {
    const n = edge.waypoints.length;
    if (n === 0) continue;
    const w = edge.waypoints[n - 1];
    edge.waypoints[n - 1] = { x: w.x + dx, y: w.y + dy };
    affected.add(edge);
  }
  return [...affected];
}

/** Re-dock every edge on `node` against its new outline; bent routes keep their bends. */
export function redockToOutline(node: SceneNode, scope?: SceneNode): SceneEdge[] {
  const changed: SceneEdge[] = [];
  for (const edge of incidentEdgesOf(node)) {
    const before = edge.waypoints.map((p) => ({ x: p.x, y: p.y }));
    if (edge.waypoints.length <= 2) {
      rerouteEdge(edge, { scope });
    } else {
      const points = edge.waypoints.map((p) => ({ x: p.x, y: p.y }));
      const last = points.length - 1;
      if (edge.source === node) points[0] = cropPoint(node, points[1]);
      if (edge.target === node) points[last] = cropPoint(node, points[last - 1]);
      edge.waypoints = orthogonalize(points, undefined, false);
    }
    if (!samePoints(before, edge.waypoints)) changed.push(edge);
  }
  return changed;
}

function samePoints(a: readonly Point[], b: readonly Point[]): boolean {
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}

/** Move nodes, edges and pinned labels by `(dx, dy)`. */
export function translateElements(elements: Iterable<SceneElement>, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const element of elements) {
    if (element.kind === 'node') {
      element.x += dx;
      element.y += dy;
    } else if (element.kind === 'edge') {
      element.waypoints = element.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    } else {
      continue;
    }
    const label = element.label;
    if (label?.pinned) {
      label.x += dx;
      label.y += dy;
    }
  }
}

function unlinkFromTree(scene: Scene, element: Drawable): void {
  const siblings = element.parent?.children ?? scene.children;
  const at = siblings.indexOf(element);
  if (at >= 0) siblings.splice(at, 1);
}

function linkIntoTree(scene: Scene, element: Drawable, parent: SceneNode | undefined): void {
  element.parent = parent;
  (parent?.children ?? scene.children).push(element);
  if (element.label) element.label.parent = parent;
}

export interface AddShapeSpec {
  type: string;
  bounds: Bounds;
  businessObject?: ModdleObject;
  attrs?: Record<string, unknown>;
  extensionType?: string;
  parent?: SceneNode;
  isExpanded?: boolean;
  /** Host activity for a boundary event. */
  attachTo?: SceneNode;
  id?: string;
}

export interface AddConnectionSpec {
  type: string;
  /** A connection is a legal source for one case: an association off a sequence flow. */
  source: SceneNode | SceneEdge;
  target: SceneNode;
  waypoints?: Point[];
  businessObject?: ModdleObject;
  attrs?: Record<string, unknown>;
  extensionType?: string;
  id?: string;
}

export interface ReconnectEnds {
  source?: SceneNode;
  target?: SceneNode;
}

export class Mutator {
  readonly ids: IdGenerator;
  private readonly scene: Scene;
  private readonly bus: EventBus;

  constructor(scene: Scene, bus: EventBus, ids?: IdGenerator) {
    this.scene = scene;
    this.bus = bus;
    this.ids = ids ?? IdGenerator.fromDefinitions(scene.definitions);
    for (const id of scene.elementsById.keys()) this.ids.claim(id);
  }

  private get factory(): ModdleFactory | undefined {
    return modelOf(this.scene.definitions) ?? modelOf(this.scene.root);
  }

  // --- geometry ---------------------------------------------------------------

  setNodeBounds(node: SceneNode, bounds: PartialBounds): SceneElement[] {
    const changed: SceneElement[] = [node, ...this.applyBounds(node, bounds)];
    this.finish(changed);
    return changed;
  }

  /** Write the bounds, carry a pinned label and the docking waypoints along. */
  private applyBounds(node: SceneNode, bounds: PartialBounds): SceneEdge[] {
    const oldX = node.x;
    const oldY = node.y;
    const oldCx = node.x + node.width / 2;
    const oldCy = node.y + node.height / 2;
    if (bounds.x !== undefined) node.x = bounds.x;
    if (bounds.y !== undefined) node.y = bounds.y;
    if (bounds.width !== undefined) node.width = Math.max(0, bounds.width);
    if (bounds.height !== undefined) node.height = Math.max(0, bounds.height);
    const label = node.label;
    if (label?.pinned) {
      label.x += node.x + node.width / 2 - oldCx;
      label.y += node.y + node.height / 2 - oldCy;
    }
    return dockConnectedEdges(node, node.x - oldX, node.y - oldY);
  }

  setEdgeWaypoints(edge: SceneEdge, points: Point[]): void {
    edge.waypoints = points.map((p) => ({ x: p.x, y: p.y }));
    this.finish([edge]);
  }

  /** Pin a caption to `bounds`. */
  setLabelBounds(label: SceneLabel, bounds: Bounds): void {
    Object.assign(label, bounds);
    label.pinned = true;
    this.finish([label.owner]);
  }

  /** Commit geometry the caller already wrote into the scene (a drag drop). */
  commit(elements: SceneElement[]): void {
    if (elements.length > 0) this.finish(elements);
  }

  // --- expand / collapse ------------------------------------------------------

  /**
   * Collapse to the plain activity box, or expand around the contents — moving
   * them into the frame first when they sit elsewhere (a nested plane keeps its own
   * coordinates until then). Incident and crossing edges re-dock to the new outline.
   */
  setExpanded(node: SceneNode, expanded: boolean): { changed: SceneElement[]; contents: SceneElement[] } {
    if (!isExpandable(node.type) || (node.isExpanded !== false) === expanded) return { changed: [], contents: [] };
    node.isExpanded = expanded;
    const contents = contentsOf(node);
    let bounds: Bounds = { x: node.x, y: node.y, ...COLLAPSED_SIZE };
    if (expanded) {
      bounds = { x: node.x, y: node.y, ...EXPANDED_SIZE };
      const box = boundsOf(contents);
      if (box) {
        const inside = box.x >= node.x && box.y >= node.y
          && box.x + box.width <= node.x + node.width && box.y + box.height <= node.y + node.height;
        if (!inside) {
          translateElements(contents, node.x + CONTENT_PADDING.left - box.x, node.y + CONTENT_PADDING.top - box.y);
        }
        bounds = frameAround(node, boundsOf(contents) ?? box);
      }
    }
    const moved = this.applyBounds(node, bounds);
    const scope = this.scene.scope;
    const redocked = [...redockToOutline(node, scope)];
    for (const edge of crossingEdgesOf(node)) if (rerouteEdge(edge, { scope })) redocked.push(edge);
    const edges = [...new Set([...moved, ...redocked])];
    const changed: SceneElement[] = [node, ...edges];
    this.finish(changed);
    return { changed, contents };
  }

  toggleExpanded(node: SceneNode): { changed: SceneElement[]; contents: SceneElement[] } {
    return this.setExpanded(node, node.isExpanded === false);
  }

  setMarkerVisible(node: SceneNode, visible: boolean): boolean {
    if (node.isMarkerVisible === visible) return false;
    node.isMarkerVisible = visible;
    this.finish([node]);
    return true;
  }

  // --- names and choreography bands -------------------------------------------

  /**
   * Write `name` on `target` (default: the first element's own business object) and
   * report the edit as a change to `elements`. A no-op edit writes nothing.
   */
  setName(elements: Drawable | Drawable[], name: string, target?: ModdleObject): boolean {
    const list = Array.isArray(elements) ? elements : [elements];
    const bo = target ?? list[0]?.businessObject;
    if (!bo || list.length === 0) return false;
    const current = prop(bo, 'name');
    if ((typeof current === 'string' ? current : '') === name) return false;
    setProp(bo, 'name', name);
    for (const element of list) syncLabel(this.scene, element);
    this.finish(list);
    return true;
  }

  /** Record a change made through another path (the inspector writing a property). */
  touch(element: Drawable): void {
    syncLabel(this.scene, element);
    this.finish([element]);
  }

  /** Record an edit of something that is not a scene element (the diagram root). */
  record(element: unknown): void {
    this.scene.revision += 1;
    this.bus.fire('ElementChanged', { element });
  }

  setBandName(node: SceneNode, band: ParticipantBand, name: string): SceneElement[] {
    if (!isChoreographyTask(node)) return [];
    const write = applyBandName(node, band, name, this.ids);
    if (!write || (!write.renamed && !write.minted)) return [];
    const affected = tasksReferencing(this.scene, write.participant, node);
    this.finish(affected);
    return affected;
  }

  setInitiator(node: SceneNode, band: ParticipantBand): boolean {
    if (!isChoreographyTask(node) || !applyInitiator(node, band, this.ids)) return false;
    this.finish([node]);
    return true;
  }

  swapInitiator(node: SceneNode): boolean {
    if (!isChoreographyTask(node)) return false;
    const current = readChoreographyBands(node.businessObject).initiator;
    return this.setInitiator(node, current === 'top' ? 'bottom' : 'top');
  }

  // --- colour -------------------------------------------------------------------

  /** An omitted field is left alone, a falsy one clears; a connection takes a stroke only. */
  setColor(elements: readonly SceneElement[], colors: ElementColors): SceneElement[] {
    const patch = normalizeColors(colors);
    const changed: SceneElement[] = [];
    for (const element of elements) {
      const target = element.kind === 'label' ? element.owner : element;
      if (changed.includes(target)) continue;
      let touched = false;
      if ('stroke' in patch && target.stroke !== (patch.stroke ?? undefined)) {
        target.stroke = patch.stroke ?? undefined;
        touched = true;
      }
      if ('fill' in patch && target.kind === 'node' && target.fill !== (patch.fill ?? undefined)) {
        target.fill = patch.fill ?? undefined;
        touched = true;
      }
      if (touched) changed.push(target);
    }
    if (changed.length > 0) this.finish(changed);
    return changed;
  }

  // --- deletion -----------------------------------------------------------------

  deleteElements(elements: readonly SceneElement[]): DeleteResult {
    return removeFromScene(this.scene, this.bus, elements);
  }

  // --- containment --------------------------------------------------------------

  /** Re-home `nodes` (contents come along) under `parent`, `undefined` meaning the root. */
  reparent(nodes: readonly SceneNode[], parent?: SceneNode): SceneElement[] {
    const scene = this.scene;
    const changed: Drawable[] = [];
    for (const node of nodes) {
      if (node === parent || (node.parent ?? undefined) === parent) continue;
      const from = flowContainerOf(node.parent, scene.root);
      const to = flowContainerOf(parent, scene.root);
      const bo = node.businessObject;
      unfile(bo, [parentOf(bo), from.owner, from.lane]);
      this.fileBusinessObject(bo, node.type, to.owner);
      if (to.lane && isBpmnSubtypeOf(node.type, 'bpmn:FlowNode')) pushInto(to.lane, 'flowNodeRef', bo);
      unlinkFromTree(scene, node);
      linkIntoTree(scene, node, parent);
      changed.push(node);
    }
    if (changed.length === 0) return [];

    // An edge lives in the container both ends share, else at the root.
    const edges = new Set<SceneEdge>();
    for (const el of changed) if (el.kind === 'node') for (const edge of incidentEdgesOf(el)) edges.add(edge);
    for (const edge of edges) {
      const next = edge.source && edge.source.parent === edge.target?.parent ? edge.source.parent : undefined;
      if ((edge.parent ?? undefined) === next) continue;
      if (edge.type === 'bpmn:SequenceFlow' || edge.type === 'bpmn:Association') {
        const bo = edge.businessObject;
        unfile(bo, [parentOf(bo)]);
        this.fileBusinessObject(bo, edge.type, flowContainerOf(next, scene.root).owner);
      }
      unlinkFromTree(scene, edge);
      linkIntoTree(scene, edge, next);
      changed.push(edge);
    }
    this.finish(changed);
    return changed;
  }

  // --- creation -----------------------------------------------------------------

  addShape(spec: AddShapeSpec): SceneNode {
    const scene = this.scene;
    const factory = this.factory ?? modelOf(spec.businessObject);
    const bo = spec.businessObject ?? mint(factory, spec.type, { ...(spec.attrs ?? {}) });
    if (spec.businessObject && spec.attrs) {
      for (const [name, value] of Object.entries(spec.attrs)) setProp(bo, name, value);
    }
    const type = typeof bo.$type === 'string' ? bo.$type : spec.type;
    const id = spec.id ?? (typeof bo.id === 'string' && bo.id ? bo.id : this.ids.next(spec.extensionType ?? type, bo));
    bo.id = id;
    this.ids.claim(id);
    if (spec.extensionType && factory?.create && !getExtensionType(bo)) {
      StudyflowElement.fromBusinessObject(bo).ensureExtension(spec.extensionType, factory as never, getDefaults(spec.extensionType));
    }

    const parentNode = spec.attachTo ? spec.attachTo.parent : spec.parent;
    if (spec.attachTo) setRef(bo, 'attachedToRef', spec.attachTo.businessObject);

    // The first pool dropped on a process root promotes the root to a collaboration.
    const promotion = type === 'bpmn:Participant' && !parentNode
      ? this.promoteRootToCollaboration(bo, factory, spec.bounds)
      : undefined;
    const bounds = promotion?.bounds ?? spec.bounds;

    const { owner, lane } = flowContainerOf(parentNode, scene.root);
    this.fileBusinessObject(bo, type, owner);
    if (lane && isBpmnSubtypeOf(type, 'bpmn:FlowNode')) pushInto(lane, 'flowNodeRef', bo);

    const node: SceneNode = {
      id,
      kind: 'node',
      type,
      businessObject: bo,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      children: [],
      incoming: [],
      outgoing: [],
    };
    if (spec.isExpanded !== undefined) node.isExpanded = spec.isExpanded;
    linkIntoTree(scene, node, parentNode);
    if (promotion) {
      for (const child of promotion.adopt) {
        unlinkFromTree(scene, child);
        linkIntoTree(scene, child, node);
      }
    }
    scene.elementsById.set(id, node);
    scene.byBusinessObject.set(bo, node);
    syncLabel(scene, node);
    this.finish([node]);
    return node;
  }

  addConnection(spec: AddConnectionSpec): SceneEdge {
    const scene = this.scene;
    const factory = this.factory ?? modelOf(spec.businessObject);
    const bo = spec.businessObject ?? mint(factory, spec.type, { ...(spec.attrs ?? {}) });
    if (spec.businessObject && spec.attrs) {
      for (const [name, value] of Object.entries(spec.attrs)) setProp(bo, name, value);
    }
    const type = typeof bo.$type === 'string' ? bo.$type : spec.type;
    const id = spec.id ?? (typeof bo.id === 'string' && bo.id ? bo.id : this.ids.next(spec.extensionType ?? type, bo));
    bo.id = id;
    this.ids.claim(id);
    if (spec.extensionType && factory?.create && !getExtensionType(bo)) {
      StudyflowElement.fromBusinessObject(bo).ensureExtension(spec.extensionType, factory as never, getDefaults(spec.extensionType));
    }

    const dataEnds = isDataAssociationType(type) && spec.source.kind === 'node'
      ? dataAssociationEnds(spec.source, spec.target)
      : undefined;
    if (isDataAssociationType(type) && !dataEnds) {
      throw new Error(`${type} is not valid between ${spec.source.type} and ${spec.target.type}`);
    }
    if (dataEnds) {
      wireDataAssociation(bo, dataEnds, this.ids);
    } else {
      setRef(bo, 'sourceRef', spec.source.businessObject);
      setRef(bo, 'targetRef', spec.target.businessObject);
      if (isBpmnSubtypeOf(type, 'bpmn:SequenceFlow')) {
        pushInto(spec.source.businessObject, 'outgoing', bo);
        pushInto(spec.target.businessObject, 'incoming', bo);
      }
      this.fileConnection(bo, type, spec.source, spec.target);
    }

    const edge: SceneEdge = {
      id,
      kind: 'edge',
      type,
      businessObject: bo,
      waypoints: (spec.waypoints ?? []).map((p) => ({ x: p.x, y: p.y })),
      ...(spec.source.kind === 'node' ? { source: spec.source } : {}),
      target: spec.target,
    };
    if (spec.source.kind === 'node') spec.source.outgoing.push(edge);
    spec.target.incoming.push(edge);
    const parentNode = spec.source.parent && spec.source.parent === spec.target.parent ? spec.source.parent : undefined;
    linkIntoTree(scene, edge, parentNode);
    scene.elementsById.set(id, edge);
    scene.byBusinessObject.set(bo, edge);
    syncLabel(scene, edge);
    this.finish([edge, spec.source, spec.target]);
    return edge;
  }

  addDataAssociation(source: SceneNode, target: SceneNode, waypoints?: Point[]): SceneEdge | undefined {
    const ends = dataAssociationEnds(source, target);
    if (!ends) return undefined;
    return this.addConnection({ type: typeForDirection(ends.direction), source, target, waypoints });
  }

  /** Move one or both ends of `edge`, rewriting the references; `waypoints` replaces the route. */
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
    this.finish(changed);
    return changed;
  }

  // --- filing -------------------------------------------------------------------

  private fileBusinessObject(bo: ModdleObject, type: string, owner: ModdleObject): void {
    const factory = this.factory;
    if (type === 'bpmn:Lane') {
      const laneSet = asModdle((prop(owner, 'laneSets') as ModdleObject[] | undefined)?.[0]) ?? this.createLaneSet(owner);
      setParent(bo, laneSet);
      pushInto(laneSet, 'lanes', bo);
      return;
    }
    if (type === 'bpmn:Participant' && !asModdle(prop(bo, 'processRef'))) {
      const process = mint(factory, 'bpmn:Process', { id: this.ids.next('bpmn:Process'), isExecutable: false });
      setParent(process, this.scene.definitions);
      pushInto(this.scene.definitions, 'rootElements', process);
      setRef(bo, 'processRef', process);
    }
    setParent(bo, owner);
    pushInto(owner, containmentPropertyFor(type), bo);
  }

  /**
   * Turn a process root into a collaboration so a pool can hold it: the process
   * stays a root element, the new pool depicts it and adopts what is drawn.
   */
  private promoteRootToCollaboration(
    participant: ModdleObject,
    factory: ModdleFactory | undefined,
    dropped: Bounds,
  ): { bounds: Bounds; adopt: Drawable[] } | undefined {
    const scene = this.scene;
    const process = scene.root;
    if (process.$type !== 'bpmn:Process') return undefined;
    const collaboration = mint(factory, 'bpmn:Collaboration', { id: this.ids.next('bpmn:Collaboration') });
    setParent(collaboration, scene.definitions);
    pushInto(scene.definitions, 'rootElements', collaboration);
    setRef(participant, 'processRef', process);
    scene.root = collaboration;
    scene.rootElement.businessObject = collaboration;
    (scene.rootElement as { id: string; type: string }).id = String(collaboration.id ?? scene.rootElement.id);
    (scene.rootElement as { id: string; type: string }).type = collaboration.$type;
    const adopt = scene.children.filter((child): child is Drawable => child.kind !== 'label');
    return { bounds: participantBoundsAround(dropped, adopt), adopt };
  }

  private createLaneSet(owner: ModdleObject): ModdleObject {
    const laneSet = mint(this.factory, 'bpmn:LaneSet', { id: this.ids.next('bpmn:LaneSet') });
    setParent(laneSet, owner);
    pushInto(owner, 'laneSets', laneSet);
    return laneSet;
  }

  private fileConnection(bo: ModdleObject, type: string, source: SceneNode | SceneEdge, target: SceneNode): void {
    if (isBpmnSubtypeOf(type, 'bpmn:MessageFlow')) {
      const collaboration = collaborationOf(this.scene);
      if (collaboration) {
        setParent(bo, collaboration);
        pushInto(collaboration, 'messageFlows', bo);
        return;
      }
    }
    const { owner } = flowContainerOf(source.parent ?? target.parent, this.scene.root);
    setParent(bo, owner);
    pushInto(owner, containmentPropertyFor(type), bo);
  }

  private finish(elements: SceneElement[]): void {
    this.scene.revision += 1;
    const touched = [...new Set(elements)];
    for (const element of touched) this.bus.fire('ElementChanged', { element });
    if (touched.length > 1) this.bus.fire('ElementsChanged', { elements: touched.slice() });
  }
}
