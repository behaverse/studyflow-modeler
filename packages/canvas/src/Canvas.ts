/**
 * The canvas: a view of a study. Owns the SVG, the viewport, the renderer and the
 * interaction modules, and is the API the host talks to.
 */

import { BPMN } from '@core/constants.ts';
import { EventBus } from '@canvas/bus.ts';

import { appendSpot } from '@canvas/study/autoplace.ts';
import { Connect } from '@canvas/interaction/connect.ts';
import { Create } from '@canvas/interaction/create.ts';
import { boundsFor, draftOf, prototypeOf, type CreatePrototype, type NewElement } from '@canvas/study/prototype.ts';
import { DEFAULT_GRID_SIZE, Drag, snapTo, type Movable } from '@canvas/study/drag.ts';
import { Gestures, ZOOM_STEP } from '@canvas/interaction/gestures.ts';
import { hitTest, obstaclesIn, type HitOptions } from '@canvas/study/hit.ts';
import { LabelEditing } from '@canvas/interaction/labelEditing.ts';
import { EDITING_MARKER, Selection } from '@canvas/interaction/selection.ts';
import { labelIdOf, syncLabel } from '@canvas/study/labels.ts';
import { modelOf } from '@canvas/study/moddle.ts';
import type { Mutator } from '@canvas/study/mutator.ts';
import { studyInternals, type ChangedIds, type Study, type StudyResult } from '@canvas/study/Study.ts';
import { isRootElement, type Bounds, type ElementRef, type ModdleObject, type Point, type RootElement, type Scene, type SceneEdge, type SceneElement, type SceneNode } from '@canvas/study/scene.ts';
import { shapeOf } from '@canvas/study/templates.ts';
import { boundsOf, isCollapsed, isExpandable, isHidden, zRankOf } from '@canvas/study/tree.ts';
import { categoryOf } from '@core/document/outline.ts';
import { edgeDashArray, ensureArrowMarkers, markerEndFor, previewEdge, Renderer, type RendererOptions } from '@canvas/render/renderer.ts';
import { append, create, remove, setDocument } from '@canvas/render/svg.ts';
import { routableEnd, routeFor } from '@canvas/study/orthogonal.ts';
import { CONNECTION, type RuleElement, type Rules } from '@canvas/study/rules.ts';
import { Layers } from '@canvas/view/layers.ts';
import { injectCanvasStyles } from '@canvas/view/theme.ts';
import { Viewport, type Viewbox } from '@canvas/view/viewport.ts';

export interface CanvasOptions extends RendererOptions {
  snapToGrid?: boolean;
}

export interface CanvasViewbox extends Viewbox {
  /** The drawn diagram. */
  inner: Bounds;
  /** The container, in screen pixels. */
  outer: { width: number; height: number };
}

export type Root = RootElement | SceneNode;

/** Shapes created unnamed and useless: their label editor opens on drop. */
const EDIT_ON_CREATE_TYPES = new Set<string>([
  BPMN.Task, BPMN.UserTask, BPMN.ServiceTask, BPMN.ScriptTask, BPMN.ManualTask, BPMN.SendTask,
  BPMN.ReceiveTask, BPMN.BusinessRuleTask, BPMN.TextAnnotation, BPMN.Group,
]);

export class Canvas {
  /** What the canvas shows and edits. */
  readonly study: Study;
  private readonly create: Create;
  private readonly connect: Connect;
  private readonly container: HTMLElement;
  private readonly root: SVGSVGElement;
  private readonly layers: Layers;
  private readonly viewport: Viewport;
  private readonly renderer: Renderer;
  private readonly bus: EventBus;
  private readonly selection: Selection;
  private readonly labelEditing: LabelEditing;
  private readonly rules: Rules;
  private readonly gestures: Gestures;
  private readonly customLayers = new Map<string, SVGGElement>();
  /** Stops hearing the study's changes. */
  private readonly stopListening: () => void;
  private snapToGrid: boolean;
  /** The container the view is drilled into; `undefined` shows the whole diagram. */
  private scope?: SceneNode;
  private drag?: Drag;
  private appendPreview?: SVGGElement;
  private resizeObserver?: ResizeObserver;
  private destroyed = false;

  /** Draw `study` into `container`, in the container's document, fitted, and follow its changes. */
  constructor(container: HTMLElement, study: Study, options: CanvasOptions = {}) {
    this.container = container;
    this.study = study;
    this.snapToGrid = options.snapToGrid ?? true;
    setDocument(container.ownerDocument);
    this.root = create('svg', { class: 'sf-canvas', width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet' }) as SVGSVGElement;
    this.root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    append(this.container, this.root);
    injectCanvasStyles(container.ownerDocument);
    this.layers = new Layers(this.root);
    ensureArrowMarkers(this.layers.defs);
    this.viewport = new Viewport(this.root, this.container);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.viewport.refitIfPending());
      this.resizeObserver.observe(this.container);
    }
    this.renderer = new Renderer(options);
    this.bus = new EventBus();
    this.rules = studyInternals(study).rules;
    this.selection = new Selection({
      layer: this.layers.getLayer('selection'),
      getGraphics: (id) => this.renderer.graphicsById.get(id),
      bus: this.bus,
      canResize: (target) => target.kind === 'label' || this.rules.canResize(target),
      resolve: (value) => this.resolveElement(value),
    });
    this.labelEditing = new LabelEditing({
      container: this.container,
      viewport: this.viewport,
      getMutator: () => this.mutator,
      restoreFocus: () => this.focus(),
      // While its text is edited in place, an element drops its outline and its drawn text: the caption, else its own.
      onEditing: (element, editing) => {
        const mark = editing ? this.selection.addMarker.bind(this.selection) : this.selection.removeMarker.bind(this.selection);
        mark(element.id, EDITING_MARKER);
        mark((element.label ?? element).id, 'sf-label-hidden');
      },
    });

    this.create = new Create({
      getScene: () => this.scene,
      rules: this.rules,
      hitTest: (point) => this.hitTest(point),
      layer: this.layers.getLayer('overlays'),
      snap: (point) => this.snapPoint(point),
      getContainer: () => this.scope,
      drop: (what, center, into) => {
        const made = this.made(this.study.add({ ...what, at: center, into: into?.id ?? this.scene.rootElement.id }));
        return made?.kind === 'node' ? made : undefined;
      },
      drawGhost: (prototype, bounds) => this.drawCreateGhost(prototype, bounds),
      markTarget: (target, allowed) => this.gestures.markDropTarget(target, allowed),
    });
    this.connect = new Connect({
      getScene: () => this.scene,
      getMutator: () => this.mutator,
      rules: this.rules,
      hitTest: (point) => this.hitTest(point),
      layer: this.layers.getLayer('overlays'),
      markTarget: (target, allowed) => this.gestures.markDropTarget(target, allowed),
      snap: (point) => this.snapPoint(point),
      link: (source, target) => {
        const made = this.made(this.study.connect({ from: source.id, to: target.id }));
        return made?.kind === 'edge' ? made : undefined;
      },
    });
    if (!this.root.hasAttribute('tabindex')) this.root.setAttribute('tabindex', '0');
    if (!this.container.hasAttribute('tabindex')) this.container.setAttribute('tabindex', '0');
    this.gestures = new Gestures(this, {
      create: this.create,
      connect: this.connect,
      drag: () => this.drag,
      overlays: this.layers.getLayer('overlays'),
      movableSelection: () => this.movableSelection(),
      viewportCentre: () => this.viewportCentre(),
      placed: (node) => this.placed(node),
      moveWaypoint: (edge, index, point) => this.moveWaypoint(edge, index, point),
      nudgeSelection: (dx, dy) => this.nudgeSelection(dx, dy),
    });
    this.stopListening = study.on('change', (change) => {
      if (change.cause === 'edit') {
        this.drawCommit(change);
        const elements = [...change.added, ...change.changed].map((id) => this.get(id)).filter((element) => element !== undefined);
        this.bus.fire('ElementsChanged', { elements, removed: change.removed });
      } else if (change.cause === 'load') {
        this.drawStudy();
      } else {
        this.drawKeepingView();
      }
    });
    this.drawStudy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gestures.destroy();
    this.stopListening();
    this.resizeObserver?.disconnect();
    this.labelEditing.reset();
    this.clearAppendPreview();
    this.bus.clear();
    this.layers.clear();
    this.customLayers.clear();
    this.renderer.graphicsById.clear();
    remove(this.root);
    this.drag = undefined;
  }

  // --- the document ---------------------------------------------------------------

  private get scene(): Scene {
    return studyInternals(this.study).scene;
  }

  private get mutator(): Mutator {
    return studyInternals(this.study).mutator;
  }

  /** Draw the study afresh, as a view that has just opened it: nothing selected, drilled into `scope` or nothing, fitted; `RootSet` says what it shows. */
  private drawStudy(scope?: SceneNode): void {
    this.resetInteraction();
    this.selection.forget();
    this.scope = scope;
    this.renderer.scope = scope;
    this.drag = new Drag({
      mutator: this.mutator,
      redraw: (elements) => this.redrawElements(elements),
      snapToGrid: this.snapToGrid,
      rules: this.rules,
      getScene: () => this.scene,
      getScope: () => this.scope,
      hitTest: (point, options) => this.hitTest(point, options),
      obstacles: (moving) => obstaclesIn(this.scene, this.scope, moving),
    });
    this.appendPreview = undefined;
    this.layers.clear();
    this.renderer.renderScene(this.scene, this.layers.getLayer('elements'));
    this.zoomToFit();
    this.bus.fire('RootSet', { element: this.getRoot() });
  }

  /** Draw the study afresh after an undo or a redo, keeping what the view showed, by id: the scope, the camera, the selection. */
  private drawKeepingView(): void {
    const selected = this.selection.get().map((element) => element.id);
    const scope = this.scope && this.scene.elementsById.get(this.scope.id);
    const viewbox = this.viewport.getViewbox();
    this.drawStudy(scope?.kind === 'node' && isExpandable(scope.type) ? scope : undefined);
    this.viewport.setViewbox(viewbox);
    const kept = selected.map((id) => this.scene.elementsById.get(id)).filter((element): element is SceneElement => !!element);
    if (kept.length > 0) this.selection.select(kept);
  }

  getScene(): Scene {
    return this.scene;
  }

  getContainer(): HTMLElement {
    return this.container;
  }

  getSvg(): SVGSVGElement {
    return this.root;
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  getEventBus(): EventBus {
    return this.bus;
  }

  getSelection(): Selection {
    return this.selection;
  }

  getRules(): Rules {
    return this.rules;
  }

  getLabelEditing(): LabelEditing {
    return this.labelEditing;
  }

  getGraphics(id: string): SVGGElement | undefined {
    return this.renderer.graphicsById.get(id);
  }

  // --- elements -------------------------------------------------------------------

  get(id: string): SceneElement | RootElement | undefined {
    const scene = this.scene;
    if (id === scene.rootElement.id) return scene.rootElement;
    return scene.elementsById.get(id);
  }

  /** Every node, edge and label, in scene order. */
  all(): SceneElement[] {
    return [...this.scene.elementsById.values()];
  }

  /** The live element behind an id, an element or a stale copy; `undefined` when nothing answers (the root included). */
  resolveElement(value: ElementRef | undefined): SceneElement | undefined {
    const scene = this.scene;
    if (!value) return undefined;
    if (typeof value === 'string') return scene.elementsById.get(value);
    if (isRootElement(value)) return undefined;
    const candidate = value as { id?: string; kind?: string };
    const found = candidate.id ? scene.elementsById.get(candidate.id) : undefined;
    if (found) return found;
    return candidate.kind === 'node' || candidate.kind === 'edge' || candidate.kind === 'label' ? (value as SceneElement) : undefined;
  }

  /** What the view shows: the drilled-into container, else the document root. */
  getRoot(): Root {
    return this.scope ?? this.scene.rootElement;
  }

  /** The nearest collapsed container `element` lives in, else the document root. */
  rootOf(element: ElementRef): Root | undefined {
    if (isRootElement(element)) return element;
    const target = this.resolveElement(element);
    if (!target) return undefined;
    const owner = target.kind === 'label' ? target.owner : target;
    for (let p = owner.parent; p; p = p.parent) if (isCollapsed(p)) return p;
    return this.scene.rootElement;
  }

  // --- drill-down scope -------------------------------------------------------------

  getScope(): SceneNode | undefined {
    return this.scope;
  }

  /** Whether this view draws the element `id`: on the plane it shows, not folded inside a collapsed container. */
  draws(id: string): boolean {
    const element = this.scene.elementsById.get(id);
    return element !== undefined && !isHidden(element, this.scope);
  }

  /** Show only `node`'s contents. */
  enterScope(node: SceneNode): boolean {
    if (!isExpandable(node.type)) return false;
    return this.setScope(node);
  }

  /** Show `target`'s contents, or the whole diagram for the root / `undefined`. */
  goToScope(target: Root | undefined): boolean {
    return this.setScope(target && !isRootElement(target) ? target : undefined);
  }

  /** Root first, then every container on the way in. */
  scopePath(): Root[] {
    const path: Root[] = [];
    for (let p = this.scope; p; p = p.parent) if (isExpandable(p.type)) path.unshift(p);
    path.unshift(this.scene.rootElement);
    return path;
  }

  private setScope(node: SceneNode | undefined): boolean {
    if (this.scope === node) return false;
    this.resetInteraction();
    this.scope = node;
    this.renderer.scope = node;
    this.redrawElements(this.all());
    this.zoomToFit();
    this.bus.fire('RootSet', { element: this.getRoot() });
    return true;
  }

  /** Drop what the user was in the middle of: a gesture, the label editor, the selection and the hover. */
  private resetInteraction(): void {
    this.gestures.cancel();
    this.labelEditing.reset();
    this.selection.clear();
    this.selection.setHovered(undefined);
  }

  // --- view -------------------------------------------------------------------------

  zoomToFit(): void {
    const visible = this.all().filter((element) => !isHidden(element, this.scope));
    this.viewport.fitBounds(boundsOf(visible) ?? { x: 0, y: 0, width: 1000, height: 1000 }, 40);
  }

  zoomIn(): number {
    return this.viewport.zoom(this.viewport.getViewbox().scale * ZOOM_STEP);
  }

  zoomOut(): number {
    return this.viewport.zoom(this.viewport.getViewbox().scale / ZOOM_STEP);
  }

  getViewbox(): CanvasViewbox {
    const box = this.viewport.getViewbox();
    const drawable = this.all().filter((element) => element.kind !== 'label');
    return {
      ...box,
      inner: boundsOf(drawable) ?? { x: 0, y: 0, width: 0, height: 0 },
      outer: { width: this.container.clientWidth || box.width, height: this.container.clientHeight || box.height },
    };
  }

  /** The screen-space box of `element`. */
  getAbsoluteBBox(element: ElementRef): Bounds {
    const target = this.resolveElement(element);
    return this.viewport.getAbsoluteBBox((target && boundsOf([target])) ?? { x: 0, y: 0, width: 0, height: 0 });
  }

  addMarker(element: ElementRef, marker: string): void {
    const target = this.resolveElement(element);
    if (target) this.selection.addMarker(target, marker);
  }

  removeMarker(element: ElementRef, marker: string): void {
    const target = this.resolveElement(element);
    if (target) this.selection.removeMarker(target, marker);
  }

  scrollToElement(element: ElementRef): void {
    const target = this.resolveElement(element);
    if (!target) throw new Error('@behaverse/studyflow-canvas: element is not on the canvas');
    this.viewport.scrollToElement(target);
  }

  /** A host-owned `<g>` above the built-in layers, created on first use and re-attached after an import. */
  getHostLayer(name: string, index = 0): SVGGElement {
    let layer = this.customLayers.get(name);
    if (!layer) {
      layer = create('g', { class: `sf-layer sf-layer-${name}`, 'data-layer': name }) as SVGGElement;
      this.customLayers.set(name, layer);
    }
    if (!layer.parentNode) this.layers.attachCustom(layer, index);
    return layer;
  }

  focus(): void {
    const active = this.root.ownerDocument?.activeElement;
    if (active === this.root) return;
    (this.root as unknown as { focus?: (options?: FocusOptions) => void }).focus?.({ preventScroll: true });
  }

  setSnapToGrid(on: boolean): void {
    this.snapToGrid = on;
    this.drag?.setSnapToGrid(on);
  }

  private snapPoint(point: Point): Point {
    if (!this.snapToGrid) return { ...point };
    return { x: snapTo(point.x, DEFAULT_GRID_SIZE), y: snapTo(point.y, DEFAULT_GRID_SIZE) };
  }

  private viewportCentre(): Point {
    const box = this.viewport.getViewbox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  // --- drawing ----------------------------------------------------------------------

  /** Draw what a commit did: erase what it removed, mount what it added, redraw what it changed, keep the paint order. */
  private drawCommit({ added, changed, removed }: ChangedIds): void {
    const drawn = (ids: readonly string[]): SceneElement[] => ids.flatMap((id) => this.scene.elementsById.get(id) ?? []);
    if (removed.length > 0) this.eraseRemoved(removed);
    for (const element of drawn(added)) this.mount(element);
    this.redrawElements(drawn(changed));
    this.restack();
  }

  /** Erase what a commit removed, and let go of it: the label editor, the hover, the markers, the selection. */
  private eraseRemoved(removed: readonly string[]): void {
    const gone = new Set(removed);
    const session = this.labelEditing.getSession();
    if (session && gone.has(session.element.id)) this.labelEditing.cancel();
    const hovered = this.selection.getHovered();
    if (hovered && gone.has(hovered.id)) this.selection.setHovered(undefined);
    for (const id of removed) {
      this.renderer.erase(id);
      this.renderer.erase(labelIdOf({ id }));
      this.selection.forget(id);
    }
    const selected = this.selection.get();
    const keep = selected.filter((element) => !gone.has(element.kind === 'label' ? element.owner.id : element.id));
    if (keep.length < selected.length) this.selection.select(keep.length > 0 ? keep : null);
  }

  /** Keep the elements layer in paint order (`zRankOf`): a commit that moves shapes into or out of a container re-sorts it. */
  private restack(): void {
    const scene = this.scene;
    const layer = this.layers.getLayer('elements');
    const entries = Array.from(layer.children).map((g, index) => {
      const element = scene.elementsById.get(g.getAttribute('data-element-id') ?? '');
      return { g, index, rank: element ? zRankOf(element) : 0 };
    });
    if (entries.every((entry, i) => i === 0 || entries[i - 1].rank <= entry.rank)) return;
    entries.sort((a, b) => a.rank - b.rank || a.index - b.index);
    for (const { g } of entries) layer.appendChild(g);
  }

  /** Re-draw `elements` (and their captions) from the scene, then refresh the selection chrome. */
  private redrawElements(elements: readonly SceneElement[]): void {
    const scene = this.scene;
    const seen = new Set<string>();
    for (const element of elements) {
      if (seen.has(element.id)) continue;
      seen.add(element.id);
      if (element.kind === 'label') {
        if (!element.owner.label) continue;
        this.renderer.redraw(element);
        this.selection.restoreMarkers(element.id);
        continue;
      }
      const label = syncLabel(scene, element);
      if (!this.renderer.redraw(element)) continue;
      this.selection.restoreMarkers(element.id);
      if (!label) {
        const labelId = labelIdOf(element);
        if (this.renderer.erase(labelId)) {
          this.selection.forget(labelId);
          if (this.selection.isSelected(labelId)) this.selection.select(this.selection.get().filter((e) => e.id !== labelId));
        }
      } else {
        if (this.renderer.graphicsById.has(label.id)) this.renderer.redraw(label);
        else this.mount(label);
        this.selection.restoreMarkers(label.id);
      }
    }
    this.renderer.refreshJumps();
    this.selection.refresh();
  }

  /** Draw a new element into the elements layer at its z-rank, with what the selection already marks on it. */
  private mount(element: SceneElement): SVGGElement {
    const g = this.renderer.draw(element);
    const layer = this.layers.getLayer('elements');
    const owner = element.kind === 'label' ? this.renderer.graphicsById.get(element.owner.id) : undefined;
    if (owner?.parentNode === layer) layer.insertBefore(g, owner.nextSibling);
    else layer.insertBefore(g, this.firstAbove(layer, element));
    this.renderer.graphicsById.set(element.id, g);
    this.selection.restoreMarkers(element.id);
    if (element.kind === 'edge') this.renderer.refreshJumps();
    if (element.kind !== 'label' && element.label) this.mount(element.label);
    return g;
  }

  private firstAbove(layer: SVGGElement, element: SceneElement): ChildNode | null {
    const scene = this.scene;
    const rank = zRankOf(element);
    for (const child of Array.from(layer.childNodes)) {
      const id = (child as Element).getAttribute?.('data-element-id');
      const other = id ? scene.elementsById.get(id) : undefined;
      if (other && zRankOf(other) > rank) return child;
    }
    return null;
  }

  private drawCreateGhost(prototype: CreatePrototype, bounds: Bounds): SVGElement | undefined {
    const ghost: SceneNode = {
      id: '',
      kind: 'node',
      type: prototype.type,
      businessObject: prototype.businessObject ?? ({ $type: prototype.type } as ModdleObject),
      ...bounds,
      children: [],
      incoming: [],
      outgoing: [],
      ...(prototype.isExpanded !== undefined ? { isExpanded: prototype.isExpanded } : {}),
    };
    const g = this.renderer.drawShape(ghost);
    if (categoryOf(prototype.type) === 'annotation') {
      g.querySelector('path')?.setAttribute('d', `M0,0 L${bounds.width},0 L${bounds.width},${bounds.height} L0,${bounds.height} Z`);
    }
    g.removeAttribute('data-element-id');
    g.classList.add('sf-ghost');
    return g;
  }

  // --- hit-testing --------------------------------------------------------------------

  hitTest(point: Point, options?: HitOptions): SceneElement | undefined {
    return hitTest(this.scene, point, { ...options, scope: this.scope });
  }

  /** The selected shapes and captions a move carries. */
  private movableSelection(): Movable[] {
    return this.selection.get().filter((e): e is Movable => e.kind !== 'edge');
  }

  // --- create / connect ----------------------------------------------------------------

  /** Begin a create drag from the palette; `event` may originate outside the canvas. False for a template the catalog lacks. */
  startCreate(event: MouseEvent | undefined, what: NewElement): boolean {
    const shape = shapeOf(what);
    return !!shape && this.gestures.startCreate(event, what, prototypeOf(shape, draftOf(shape, modelOf(this.scene.definitions))));
  }

  /** A freshly created shape: selected, and (for a task-like shape) named. */
  private placed(node: SceneNode): void {
    this.selection.select(node);
    if (EDIT_ON_CREATE_TYPES.has(node.type) || isCollapsed(node)) this.labelEditing.activate(node);
  }

  /** The element a study verb made, as the scene holds it. */
  private made(result: StudyResult): SceneElement | undefined {
    return result.id === undefined ? undefined : this.scene.elementsById.get(result.id);
  }

  /** Click-append: the study adds `what` beside `from` and connects the two; then it is selected, and named when task-like. */
  append(from: string, what: NewElement): StudyResult {
    const result = this.study.append({ ...what, from });
    const made = this.made(result);
    if (made?.kind === 'node') this.placed(made);
    return result;
  }

  startConnect(source: SceneNode, event?: MouseEvent): boolean {
    return this.gestures.startConnect(source, event);
  }

  /** Ghost what appending `what` to `from` would add, where the click puts it; returns its bounds. */
  previewAppend(from: string, what: NewElement): Bounds | undefined {
    this.clearAppendPreview();
    const source = this.scene.elementsById.get(from);
    const shape = shapeOf(what);
    if (!source || source.kind === 'label' || !shape) return undefined;
    const prototype = prototypeOf(shape, draftOf(shape, modelOf(this.scene.definitions)));
    if (!this.rules.canAppendType(source, prototype.type)) return undefined;
    const bounds = boundsFor(prototype, appendSpot(this.scene, source, prototype, prototype.type));
    const preview = create('g', { class: 'sf-preview sf-append-preview' }) as SVGGElement;
    const probe: RuleElement = { type: prototype.type, businessObject: prototype.businessObject, parent: source.parent };
    const spec = this.rules.canConnect(source, probe);
    const type = spec ? spec.type : CONNECTION.sequenceFlow;
    const line = previewEdge(routeFor(type, routableEnd(source), { ...bounds, type: prototype.type }), 'sf-append-preview-line', {
      dash: edgeDashArray(type),
      markerEnd: markerEndFor(type),
    });
    if (line) append(preview, line);
    const ghost = this.drawCreateGhost(prototype, bounds);
    if (ghost) append(preview, ghost);
    append(this.layers.getLayer('overlays'), preview);
    this.appendPreview = preview;
    return bounds;
  }

  clearAppendPreview(): void {
    remove(this.appendPreview);
    this.appendPreview = undefined;
  }

  /** Move one waypoint and commit it. */
  private moveWaypoint(edge: SceneEdge, index: number, point: Point): void {
    if (index < 0 || index >= edge.waypoints.length) return;
    const at = this.snapPoint(point);
    this.mutator.setEdgeWaypoints(edge, edge.waypoints.map((p, i) => (i === index ? at : p)));
  }

  // --- edits --------------------------------------------------------------------------------


  private nudgeSelection(dx: number, dy: number): boolean {
    const drag = this.drag;
    if (!drag || drag.isActive()) return false;
    const movable = this.movableSelection();
    if (movable.length === 0) return false;
    if (!drag.startMove(movable, { x: 0, y: 0 }, { snapToGrid: false, rerouteEdges: false })) return false;
    drag.end({ x: dx, y: dy });
    return true;
  }

  /** Open the inline editor on `element` (default: the single selected element). */
  editLabel(element?: SceneElement): boolean {
    const target = element ?? (this.selection.get().length === 1 ? this.selection.get()[0] : undefined);
    return !!target && this.labelEditing.activate(target);
  }

  selectAll(): boolean {
    const all = this.all().filter((element) => element.kind !== 'label' && !isHidden(element, this.scope));
    if (all.length === 0) return false;
    this.selection.select(all);
    return true;
  }

  /** Remove what is selected, as one edit (a caption clears the name it shows). */
  deleteSelection(): StudyResult {
    return this.study.remove({ ids: this.selection.get().map((element) => element.id) });
  }
}
