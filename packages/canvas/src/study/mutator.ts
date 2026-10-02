/**
 * Every committed edit of the study: writes the scene and the study model,
 * and ends in one commit per edit, or per `batch` of edits: the revision goes up once
 * and the owner hears what the commit did (the Study, which tells its views). The
 * drawing is never written here; the study's layout is rewritten from the scene on each
 * commit (`study/di.ts`).
 */

import { isDataAssociationType } from '@core/element/index.ts';
import type { Element } from '@core/model/index.ts';
import { isBpmnSubtypeOf } from '@core/notation/bpmn.ts';

import {
  applyBandName,
  isChoreographyTask,
  tasksReferencing,
  type ParticipantBand,
} from '@canvas/study/choreography.ts';
import { normalizeColors } from '@canvas/study/color.ts';
import { formatFont, mergeFont, type FontPatch } from '@canvas/study/font.ts';
import {
  activityOf,
  dataAssociationEnds,
  pruneDataAssociation,
  wireDataAssociation,
} from '@canvas/study/dataAssociation.ts';
import { IdGenerator } from '@canvas/study/ids.ts';
import { syncLabel } from '@canvas/study/labels.ts';
import { addRef, dropRef, listOf, mint, refOf, setRef } from '@canvas/study/elements.ts';
import { mintTyped } from '@canvas/study/prototype.ts';
import { deleteElements as removeFromScene, type DeleteResult } from '@canvas/study/remove.ts';
import type {
  Bounds,
  Drawable,
  ElementColors,
  Point,
  RootElement,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/study/scene.ts';
import { isRootElement } from '@canvas/study/scene.ts';
import { changeRoot } from '@canvas/study/root.ts';
import {
  boundsOf,
  COLLAPSED_SIZE,
  CONTENT_PADDING,
  contentsOf,
  crossingEdgesOf,
  EXPANDED_SIZE,
  frameAround,
  incidentEdgesOf,
} from '@canvas/study/tree.ts';
import { cropPoint, isExpandable } from '@core/document/outline.ts';
import { samePoints } from '@canvas/study/edit.ts';
import { orthogonalize, rerouteEdge } from '@canvas/study/orthogonal.ts';
import { containerFor } from '@canvas/study/rules.ts';


export interface PartialBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface FlowContainer {
  /** The element that files the element (`bpmn:Process`, `bpmn:SubProcess`, `bpmn:Collaboration`). */
  owner: Element;
  /** The lane the element sits in, when the pool is divided into lanes. */
  lane?: Element;
}

/**
 * Where a shape dropped on `parent` is filed: a group hands over to its own
 * container, a lane claims by reference and hands over to the pool, a pool files
 * into its process, and nothing at all means the diagram root.
 */
function flowContainerOf(scene: Scene, parent: SceneNode | undefined): FlowContainer {
  let lane: Element | undefined;
  let node = containerFor(parent) as SceneNode | undefined;
  const guard = new Set<SceneNode>();
  while (node && node.type === 'bpmn:Lane' && !guard.has(node)) {
    guard.add(node);
    lane ??= node.element;
    node = containerFor(node.parent) as SceneNode | undefined;
  }
  let owner = node ? node.element : scene.root;
  if (node?.type === 'bpmn:Participant') owner = refOf(scene.model, node.element, 'processRef') ?? owner;
  return lane ? { owner, lane } : { owner };
}

function containmentPropertyFor(type: string): 'participants' | 'artifacts' | 'flowElements' {
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

/** The collaboration a message flow between `ends` belongs to: the one holding the pool either end sits in. */
function collaborationOf(scene: Scene, ...ends: (SceneNode | SceneEdge)[]): Element | undefined {
  for (const end of ends) {
    let node: SceneNode | undefined = end.kind === 'node' ? end : undefined;
    while (node && node.type !== 'bpmn:Participant') node = node.parent;
    const owner = node && scene.model.parentOf(node.element);
    if (owner && scene.model.host(owner) === 'bpmn:Collaboration') return owner;
  }
  return undefined;
}

/** Shift the docking waypoints of every edge on `node` by `(dx, dy)`. */
function dockConnectedEdges(node: SceneNode, dx: number, dy: number): SceneEdge[] {
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
function redockToOutline(node: SceneNode): SceneEdge[] {
  const changed: SceneEdge[] = [];
  for (const edge of incidentEdgesOf(node)) {
    const before = edge.waypoints.map((p) => ({ x: p.x, y: p.y }));
    if (edge.waypoints.length <= 2) {
      rerouteEdge(edge);
    } else {
      const points = edge.waypoints.map((p) => ({ x: p.x, y: p.y }));
      const last = points.length - 1;
      if (edge.source === node) points[0] = cropPoint(node, points[1]);
      if (edge.target === node) points[last] = cropPoint(node, points[last - 1]);
      edge.waypoints = orthogonalize(points);
    }
    if (!samePoints(before, edge.waypoints)) changed.push(edge);
  }
  return changed;
}

/** Move nodes, edges and pinned labels by `(dx, dy)`. */
function translateElements(elements: Iterable<SceneElement>, dx: number, dy: number): void {
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
  /** The element to draw, when it is made already (a template's root). */
  element?: Element;
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
  element?: Element;
  attrs?: Record<string, unknown>;
  extensionType?: string;
  id?: string;
}

export interface ReconnectEnds {
  source?: SceneNode;
  target?: SceneNode;
}

/** What one commit did to the scene: what a view draws, and what a listener hears. */
export interface Commit {
  /** Nodes and edges new to the scene. */
  added: Drawable[];
  /** What else the commit wrote, or changed the drawing of; the root element when the diagram's own properties changed. */
  changed: (SceneElement | RootElement)[];
  /** Nodes and edges gone from the scene. */
  removed: Drawable[];
}

interface OpenCommit {
  added: Set<Drawable>;
  changed: Set<SceneElement | RootElement>;
  removed: Set<Drawable>;
}

export class Mutator {
  readonly ids: IdGenerator;
  private readonly scene: Scene;
  private readonly onCommit: (commit: Commit) => void;
  private open?: OpenCommit;

  constructor(scene: Scene, onCommit: (commit: Commit) => void) {
    this.scene = scene;
    this.onCommit = onCommit;
    this.ids = IdGenerator.fromModel(scene.model);
    for (const id of scene.elementsById.keys()) this.ids.claim(id);
  }

  /**
   * Make every edit `edit` makes one commit: one revision, one drawing pass, one change announced, one undo
   * step. A batch inside a batch joins it. What `edit` wrote before it threw is committed all the same.
   */
  batch<T>(edit: () => T): T {
    if (this.open) return edit();
    const open: OpenCommit = { added: new Set(), changed: new Set(), removed: new Set() };
    this.open = open;
    try {
      return edit();
    } finally {
      this.open = undefined;
      this.close(open);
    }
  }

  private finish(changed: Iterable<SceneElement | RootElement>, added: Iterable<Drawable> = [], removed: Iterable<Drawable> = []): void {
    this.batch(() => {
      const open = this.open!;
      for (const element of added) open.added.add(element);
      for (const element of changed) open.changed.add(element);
      for (const element of removed) open.removed.add(element);
    });
  }

  /** An element added and removed in one commit was never there; one added is not also changed. */
  private close({ added, changed, removed }: OpenCommit): void {
    for (const element of removed) {
      if (added.delete(element)) removed.delete(element);
      changed.delete(element);
    }
    for (const element of added) changed.delete(element);
    if (added.size + changed.size + removed.size === 0) return;
    // Captions keep step with their owners, drawn or not.
    for (const element of [...added, ...changed]) if (!isRootElement(element) && element.kind !== 'label') syncLabel(this.scene, element);
    this.scene.revision += 1;
    this.onCommit({ added: [...added], changed: [...changed], removed: [...removed] });
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

  /** Commit geometry the caller already wrote into the scene (a drag drop). */
  commit(elements: SceneElement[]): void {
    if (elements.length > 0) this.finish(elements);
  }

  // --- expand / collapse ------------------------------------------------------

  /**
   * Collapse to the plain activity box, or expand around the contents — moving
   * them into the frame first when they sit elsewhere (placed while it was collapsed).
   * Incident and crossing edges re-dock to the new outline.
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
    const redocked = [...redockToOutline(node)];
    for (const edge of crossingEdgesOf(node)) if (rerouteEdge(edge)) redocked.push(edge);
    const edges = [...new Set([...moved, ...redocked])];
    const changed: SceneElement[] = [node, ...edges];
    // The contents change too: they are shown or hidden, and may have moved into the frame.
    this.finish([...changed, ...contents]);
    return { changed, contents };
  }

  // --- names and choreography bands -------------------------------------------

  /** Write `name` on `element`'s element; a no-op edit writes nothing. An empty name clears it. */
  setName(element: Drawable, name: string): boolean {
    const target = element.element;
    const current = target.name;
    if ((typeof current === 'string' ? current : '') === name) return false;
    if (name) target.name = name;
    else delete target.name;
    syncLabel(this.scene, element);
    this.finish([element]);
    return true;
  }

  /** Record a change made through another path (the inspector writing a property): `elements` are what it changes the drawing of. */
  touch(elements: readonly Drawable[]): void {
    for (const element of elements) syncLabel(this.scene, element);
    this.finish(elements);
  }

  /** Record an edit of the diagram's own properties, on the root. */
  record(root: RootElement): void {
    this.finish([root]);
  }

  setBandName(node: SceneNode, band: ParticipantBand, name: string): SceneElement[] {
    if (!isChoreographyTask(node)) return [];
    const write = applyBandName(this.scene.model, node, band, name, this.ids);
    if (!write || (!write.renamed && !write.minted)) return [];
    const affected = tasksReferencing(this.scene, write.participant, node);
    this.finish(affected);
    return affected;
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

  /** Restyle captions; a label restyles the element it names. An omitted field is left alone, a falsy one clears. */
  setFont(elements: readonly SceneElement[], patch: FontPatch): SceneElement[] {
    const changed: SceneElement[] = [];
    for (const element of elements) {
      const target = element.kind === 'label' ? element.owner : element;
      if (changed.includes(target)) continue;
      const next = mergeFont(target.font, patch);
      if (formatFont(next) === formatFont(target.font)) continue;
      target.font = next;
      changed.push(target);
    }
    if (changed.length > 0) this.finish(changed);
    return changed;
  }

  // --- deletion -----------------------------------------------------------------

  deleteElements(elements: readonly SceneElement[]): DeleteResult {
    const result = removeFromScene(this.scene, elements, this.ids);
    this.finish(result.rootChanged ? [...result.changed, this.scene.rootElement] : result.changed, [], result.removed);
    return result;
  }

  // --- containment --------------------------------------------------------------

  /** Re-home `nodes` (contents come along) under `parent`, `undefined` meaning the root. */
  reparent(nodes: readonly SceneNode[], parent?: SceneNode): SceneElement[] {
    const scene = this.scene;
    const changed: Drawable[] = [];
    for (const node of nodes) {
      if (node === parent || (node.parent ?? undefined) === parent) continue;
      const from = flowContainerOf(scene, node.parent);
      const to = flowContainerOf(scene, parent);
      const element = node.element;
      const holder = scene.model.unfile(element)?.parent;
      if (from.lane) dropRef(from.lane, 'flowNodeRef', element);
      this.fileElement(element, node.type, to.owner);
      if (to.lane && isBpmnSubtypeOf(node.type, 'bpmn:FlowNode')) addRef(to.lane, 'flowNodeRef', element);
      // A lane set left empty goes, as on a deletion (study/remove.ts).
      if (holder && scene.model.host(holder) === 'bpmn:LaneSet' && listOf(holder, 'lanes').length === 0) scene.model.unfile(holder);
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
        scene.model.unfile(edge.element);
        this.fileElement(edge.element, edge.type, flowContainerOf(scene, next).owner);
      }
      unlinkFromTree(scene, edge);
      linkIntoTree(scene, edge, next);
      changed.push(edge);
    }
    this.finish(changed);
    return changed;
  }

  // --- creation -----------------------------------------------------------------

  /** The element for a new shape or flow: the one `spec` hands in, or one minted from it; its id claimed, its extension typing it. */
  private elementFor(spec: Pick<AddShapeSpec, 'type' | 'element' | 'attrs' | 'extensionType' | 'id'>): { element: Element; type: string; id: string } {
    const { model } = this.scene;
    const element = spec.element ?? mintTyped(model, spec.type, { ...(spec.attrs ?? {}) }, spec.extensionType);
    if (spec.element && spec.attrs) Object.assign(element, spec.attrs);
    const type = model.host(element);
    const id = spec.id ?? (typeof element.id === 'string' && element.id ? element.id : this.ids.next(spec.extensionType ?? type));
    element.id = id;
    this.ids.claim(id);
    return { element, type, id };
  }

  addShape(spec: AddShapeSpec): SceneNode {
    const scene = this.scene;
    const { element, type, id } = this.elementFor(spec);

    const parentNode = spec.attachTo ? spec.attachTo.parent : spec.parent;
    if (spec.attachTo) setRef(scene.model, element, 'attachedToRef', spec.attachTo.element);

    // The first pool dropped on a process root promotes the root to a collaboration.
    const promotion = type === 'bpmn:Participant' && !parentNode
      ? this.promoteRootToCollaboration(element, spec.bounds)
      : undefined;
    const bounds = promotion?.bounds ?? spec.bounds;

    const { owner, lane } = flowContainerOf(scene, parentNode);
    this.fileElement(element, type, owner);
    if (lane && isBpmnSubtypeOf(type, 'bpmn:FlowNode')) addRef(lane, 'flowNodeRef', element);

    const node: SceneNode = {
      id,
      kind: 'node',
      type,
      element,
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
    syncLabel(scene, node);
    this.finish(promotion ? [scene.rootElement, ...promotion.adopt] : [], [node]);
    return node;
  }

  /**
   * Draw `fragment`, a study drawn on its own (a paste), into `parent` (the root when none), moved `by`: what it
   * holds at its top is filed there, the rest stays in what holds it; what else it brings (a group's category)
   * becomes the study's.
   */
  graft(fragment: Scene, parent: SceneNode | undefined, by: Point): void {
    const scene = this.scene;
    const { model } = scene;
    const { owner, lane } = flowContainerOf(scene, parent);
    const added: Drawable[] = [];
    const collect = (element: SceneElement): void => {
      if (element.kind === 'label') return;
      added.push(element);
      if (element.kind === 'node') element.children.forEach(collect);
    };
    const top = [...fragment.rootElement.children];
    top.forEach(collect);
    for (const element of fragment.elementsById.values()) {
      if (element.kind === 'edge') element.waypoints = element.waypoints.map((p) => ({ x: p.x + by.x, y: p.y + by.y }));
      else {
        element.x += by.x;
        element.y += by.y;
      }
      scene.elementsById.set(element.id, element);
      if (element.kind !== 'label') this.ids.claim(element.id);
    }
    for (const element of top) {
      if (element.kind === 'label') continue;
      linkIntoTree(scene, element, parent);
      // A data association stays filed on its activity.
      if (isDataAssociationType(element.type)) continue;
      fragment.model.unfile(element.element);
      model.file(element.element, owner, containmentPropertyFor(element.type));
      if (lane && element.kind === 'node' && isBpmnSubtypeOf(element.type, 'bpmn:FlowNode')) addRef(lane, 'flowNodeRef', element.element);
    }
    for (const root of [...fragment.model.study.roots]) {
      if (root === fragment.root) continue;
      fragment.model.unfile(root);
      model.file(root, undefined);
    }
    for (const element of added) element.element = model.get(element.id) ?? element.element;
    this.finish([], added);
  }

  addConnection(spec: AddConnectionSpec): SceneEdge {
    const scene = this.scene;
    const { model } = scene;
    const { element, type, id } = this.elementFor(spec);

    const dataEnds = isDataAssociationType(type) && spec.source.kind === 'node'
      ? dataAssociationEnds(model, spec.source, spec.target)
      : undefined;
    if (isDataAssociationType(type) && !dataEnds) {
      throw new Error(`${type} is not valid between ${spec.source.type} and ${spec.target.type}`);
    }
    if (dataEnds) {
      wireDataAssociation(model, element, dataEnds, this.ids);
    } else {
      setRef(model, element, 'sourceRef', spec.source.element);
      setRef(model, element, 'targetRef', spec.target.element);
      // A flow's ends say it is one of theirs once it is filed; a list either keeps of its own goes stale.
      if (isBpmnSubtypeOf(type, 'bpmn:SequenceFlow')) {
        delete spec.source.element.outgoing;
        delete spec.target.element.incoming;
      }
      this.fileConnection(element, type, spec.source, spec.target);
    }

    const edge: SceneEdge = {
      id,
      kind: 'edge',
      type,
      element,
      waypoints: (spec.waypoints ?? []).map((p) => ({ x: p.x, y: p.y })),
      ...(spec.source.kind === 'node' ? { source: spec.source } : {}),
      target: spec.target,
    };
    if (spec.source.kind === 'node') spec.source.outgoing.push(edge);
    spec.target.incoming.push(edge);
    const parentNode = spec.source.parent && spec.source.parent === spec.target.parent ? spec.source.parent : undefined;
    linkIntoTree(scene, edge, parentNode);
    scene.elementsById.set(id, edge);
    syncLabel(scene, edge);
    this.finish([spec.source, spec.target], [edge]);
    return edge;
  }

  /** Move one or both ends of `edge`, rewriting the references; `waypoints` replaces the route. */
  reconnect(edge: SceneEdge, ends: ReconnectEnds, waypoints?: Point[]): SceneElement[] {
    const changed: SceneElement[] = [edge];
    const isSequenceFlow = isBpmnSubtypeOf(edge.type, 'bpmn:SequenceFlow');
    // A data association's references are its wiring on the activity, not its two drawn ends.
    const isDataAssociation = isDataAssociationType(edge.type);
    const track = (node: SceneNode | undefined): void => {
      if (node && !changed.includes(node)) changed.push(node);
    };
    const moves = (ends.source && ends.source !== edge.source) || (ends.target && ends.target !== edge.target);
    if (isDataAssociation && moves) this.rewireDataAssociation(edge, ends.source ?? edge.source, ends.target ?? edge.target);
    const { model } = this.scene;
    if (ends.source && ends.source !== edge.source) {
      const previous = edge.source;
      if (previous) {
        previous.outgoing = previous.outgoing.filter((e) => e !== edge);
        if (isSequenceFlow) delete previous.element.outgoing;
      }
      edge.source = ends.source;
      if (!ends.source.outgoing.includes(edge)) ends.source.outgoing.push(edge);
      if (!isDataAssociation) setRef(model, edge.element, 'sourceRef', ends.source.element);
      if (isSequenceFlow) delete ends.source.element.outgoing;
      track(previous);
      track(ends.source);
    }
    if (ends.target && ends.target !== edge.target) {
      const previous = edge.target;
      if (previous) {
        previous.incoming = previous.incoming.filter((e) => e !== edge);
        if (isSequenceFlow) delete previous.element.incoming;
      }
      edge.target = ends.target;
      if (!ends.target.incoming.includes(edge)) ends.target.incoming.push(edge);
      if (!isDataAssociation) setRef(model, edge.element, 'targetRef', ends.target.element);
      if (isSequenceFlow) delete ends.target.element.incoming;
      track(previous);
      track(ends.target);
    }
    if (waypoints) edge.waypoints = waypoints.map((p) => ({ x: p.x, y: p.y }));
    this.finish(changed);
    return changed;
  }

  /**
   * Move a data association onto new ends: it gives back its slot in the old activity's `ioSpecification` and
   * leaves that activity, as a removal does, and is wired to the new ends as {@link addConnection} wires one.
   */
  private rewireDataAssociation(edge: SceneEdge, source: SceneNode | undefined, target: SceneNode | undefined): void {
    const { model } = this.scene;
    const next = dataAssociationEnds(model, source, target);
    if (!next) throw new Error(`${edge.type} is not valid between ${source?.type} and ${target?.type}`);
    const association = edge.element;
    const owner = activityOf(model, association);
    pruneDataAssociation(model, association, owner);
    delete association.sourceRef;
    delete association.targetRef;
    if (owner) model.unfile(association);
    wireDataAssociation(model, association, next, this.ids);
  }

  // --- filing -------------------------------------------------------------------

  private fileElement(element: Element, type: string, owner: Element): void {
    const { model } = this.scene;
    if (type === 'bpmn:Lane') {
      const laneSet = listOf(owner, 'laneSets')[0] ?? this.createLaneSet(owner);
      model.file(element, laneSet, 'lanes');
      return;
    }
    if (type === 'bpmn:Participant' && !refOf(model, element, 'processRef')) {
      const process = mint('bpmn:Process', { id: this.ids.next('bpmn:Process'), isExecutable: false });
      model.file(process, undefined);
      setRef(model, element, 'processRef', process);
    }
    model.file(element, owner, containmentPropertyFor(type));
  }

  /**
   * Turn a process root into a collaboration so a pool can hold it: the collaboration
   * becomes the root and takes the study over (`study/root.ts`), the process stays a
   * root element under a fresh id, and the new pool depicts it and adopts what is
   * drawn. Deleting the last pool undoes it (`study/remove.ts`).
   */
  private promoteRootToCollaboration(participant: Element, dropped: Bounds): { bounds: Bounds; adopt: Drawable[] } | undefined {
    const scene = this.scene;
    const { model } = scene;
    const process = scene.root;
    if (model.host(process) !== 'bpmn:Process') return undefined;
    const collaboration = mint('bpmn:Collaboration');
    model.file(collaboration, undefined);
    // The pool names the process by the id it has once the collaboration takes the study's.
    changeRoot(scene, process, collaboration, this.ids);
    setRef(model, participant, 'processRef', process);
    const adopt = scene.children.filter((child): child is Drawable => child.kind !== 'label');
    return { bounds: participantBoundsAround(dropped, adopt), adopt };
  }

  private createLaneSet(owner: Element): Element {
    const laneSet = mint('bpmn:LaneSet', { id: this.ids.next('bpmn:LaneSet') });
    this.scene.model.file(laneSet, owner, 'laneSets');
    return laneSet;
  }

  private fileConnection(element: Element, type: string, source: SceneNode | SceneEdge, target: SceneNode): void {
    const { model } = this.scene;
    if (isBpmnSubtypeOf(type, 'bpmn:MessageFlow')) {
      const collaboration = collaborationOf(this.scene, source, target);
      if (collaboration) {
        model.file(element, collaboration, 'messageFlows');
        return;
      }
    }
    const { owner } = flowContainerOf(this.scene, source.parent ?? target.parent);
    model.file(element, owner, containmentPropertyFor(type));
  }
}
