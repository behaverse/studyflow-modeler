/**
 * The canvas: owns the scene, the SVG, the viewport, the renderer and the
 * interaction modules, and is the API the host talks to.
 */

import { BPMN } from '@core/constants.ts';
import { getExtensionType } from '@core/element/index.ts';
import { EventBus } from '@canvas/bus.ts';

import { appendElement as autoPlaceAppend, appendSourceBounds, freeAppendPosition } from '@canvas/interaction/autoplace.ts';
import { Connect } from '@canvas/interaction/connect.ts';
import { boundsFor, Create, createShape, defaultSizeFor, type CreatePrototype, type ShapeDescriptor } from '@canvas/interaction/create.ts';
import { DEFAULT_GRID_SIZE, Drag, snapTo, type Movable } from '@canvas/interaction/drag.ts';
import { Gestures, ZOOM_STEP } from '@canvas/interaction/gestures.ts';
import { edgesIntersecting, hitTest, isContainerNode, nodesIntersecting, orderedNodes, pointInBox, type HitOptions } from '@canvas/interaction/hit.ts';
import { LabelEditing } from '@canvas/interaction/labelEditing.ts';
import { EDITING_MARKER, OUTLINE_CLASS, Selection } from '@canvas/interaction/selection.ts';
import { tasksReferencing } from '@canvas/model/choreography.ts';
import { writeDi } from '@canvas/model/di.ts';
import { importDefinitions, type ImportOptions } from '@canvas/model/import.ts';
import { labelIdOf, syncLabel } from '@canvas/model/labels.ts';
import type { IdGenerator } from '@canvas/model/ids.ts';
import { eventDefinitionTypeOf, prop, setProp } from '@canvas/model/moddle.ts';
import { Mutator, type Commit } from '@canvas/model/mutator.ts';
import { isRootElement, type Bounds, type Drawable, type ElementColors, type ElementRef, type FontPatch, type ModdleObject, type Point, type RootElement, type Scene, type SceneEdge, type SceneElement, type SceneNode } from '@canvas/model/scene.ts';
import { boundsOf, edgesAffectedBy, isCollapsed, isExpandable, isHidden, zRankOf } from '@canvas/model/tree.ts';
import { categoryOf } from '@canvas/render/shapes.ts';
import { edgeDashArray, ensureArrowMarkers, markerEndFor, previewEdge, Renderer, type RendererOptions } from '@canvas/render/renderer.ts';
import { append, create, ownerDocument, remove } from '@canvas/render/svg.ts';
import { centerOf } from '@canvas/routing/crop.ts';
import { rerouteEdges as rerouteEdgeSet, routableEnd, routeFor } from '@canvas/routing/orthogonal.ts';
import { CONNECTION, isDataShape, Rules, type RuleElement } from '@canvas/rules/rules.ts';
import { CUSTOM_LAYER_ATTRIBUTE, Layers } from '@canvas/view/layers.ts';
import { injectCanvasStyles } from '@canvas/view/theme.ts';
import { Viewport, type Viewbox } from '@canvas/view/viewport.ts';

export interface CanvasOptions extends RendererOptions {
  /** Host element the SVG root is appended to; a detached `<div>` when omitted. */
  container?: HTMLElement;
  onWarning?: ImportOptions['onWarning'];
  snapToGrid?: boolean;
  /**
   * Import only the main canvas: nothing inside a sub-process, collapsed or expanded. For views
   * that read rather than edit, such as a thumbnail or an overview; drilling in finds it empty.
   */
  mainCanvasOnly?: boolean;
}

export interface CanvasViewbox extends Viewbox {
  /** The drawn diagram. */
  inner: Bounds;
  /** The container, in screen pixels. */
  outer: { width: number; height: number };
}

export type Root = RootElement | SceneNode;

const EXPORT_MARGIN = 4;

/** Shapes created unnamed and useless: their label editor opens on drop. */
const EDIT_ON_CREATE_TYPES = new Set<string>([
  BPMN.Task, BPMN.UserTask, BPMN.ServiceTask, BPMN.ScriptTask, BPMN.ManualTask, BPMN.SendTask,
  BPMN.ReceiveTask, BPMN.BusinessRuleTask, BPMN.TextAnnotation, BPMN.Group,
]);

export class Canvas {
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
  private readonly importOptions: ImportOptions;
  private snapToGrid: boolean;
  private scene?: Scene;
  private mutator?: Mutator;
  private drag?: Drag;
  private appendPreview?: SVGGElement;
  private resizeObserver?: ResizeObserver;
  private destroyed = false;

  constructor(options: CanvasOptions = {}) {
    const doc = ownerDocument();
    this.container = options.container ?? doc.createElement('div');
    this.importOptions = { onWarning: options.onWarning, mainCanvasOnly: options.mainCanvasOnly };
    this.snapToGrid = options.snapToGrid ?? true;
    this.root = create('svg', { class: 'sf-canvas', width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet' }) as SVGSVGElement;
    this.root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    append(this.container, this.root);
    injectCanvasStyles(this.root.ownerDocument ?? doc);
    this.layers = new Layers(this.root);
    ensureArrowMarkers(this.layers.defs);
    this.viewport = new Viewport(this.root, this.container);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.viewport.refitIfPending());
      this.resizeObserver.observe(this.container);
    }
    this.renderer = new Renderer(options);
    this.bus = new EventBus();
    this.rules = new Rules();
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
      getMutator: () => this.mutator,
      rules: this.rules,
      hitTest: (point) => this.hitTest(point),
      layer: this.layers.getLayer('overlays'),
      snap: (point) => this.snapPoint(point),
      getContainer: () => this.scene?.scope,
      drawGhost: (prototype, bounds) => this.drawCreateGhost(prototype, bounds),
      markTarget: (target, allowed) => this.gestures.markDropTarget(target, allowed),
    });
    this.connect = new Connect({
      getScene: () => this.scene,
      getMutator: () => this.mutator,
      rules: this.rules,
      hitTest: (point) => this.hitTest(point),
      layer: this.layers.getLayer('overlays'),
      routeOptions: () => ({ scope: this.scene?.scope }),
      markTarget: (target, allowed) => this.gestures.markDropTarget(target, allowed),
      snap: (point) => this.snapPoint(point),
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
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gestures.destroy();
    this.resizeObserver?.disconnect();
    this.labelEditing.reset();
    this.clearAppendPreview();
    this.bus.clear();
    this.layers.clear();
    this.customLayers.clear();
    this.renderer.graphicsById.clear();
    remove(this.root);
    this.scene = undefined;
    this.mutator = undefined;
    this.drag = undefined;
  }

  // --- the document ---------------------------------------------------------------

  /** Build the scene from `definitions` (with DI), draw it and fit the viewport. */
  importDefinitions(definitions: ModdleObject): Scene {
    this.resetInteraction();
    this.selection.forget();
    this.scene = importDefinitions(definitions, this.importOptions);
    this.mutator = new Mutator(this.scene, this.bus, (commit) => this.drawCommit(commit));
    this.drag = new Drag({
      mutator: this.mutator,
      redraw: (elements) => this.redrawElements(elements),
      snapToGrid: this.snapToGrid,
      rules: this.rules,
      getScene: () => this.scene,
      hitTest: (point, options) => this.hitTest(point, options),
      obstacles: (moving) => this.routeObstacles(moving),
    });
    this.appendPreview = undefined;
    this.layers.clear();
    this.renderer.renderScene(this.scene, this.layers.getLayer('elements'));
    this.zoomToFit();
    return this.scene;
  }

  /** Rebuild the DI from the scene, so `definitions` is ready to serialize. */
  syncDi(): void {
    if (this.scene) writeDi(this.scene);
  }

  getScene(): Scene | undefined {
    return this.scene;
  }

  getDefinitions(): ModdleObject | undefined {
    return this.scene?.definitions;
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

  /** The ids the open document holds and the next ones to mint; none before an import. */
  getIds(): IdGenerator | undefined {
    return this.mutator?.ids;
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
    if (!scene) return undefined;
    if (id === scene.rootElement.id) return scene.rootElement;
    return scene.elementsById.get(id);
  }

  /** Every node, edge and label, in scene order. */
  all(): SceneElement[] {
    return this.scene ? [...this.scene.elementsById.values()] : [];
  }

  /** The live element behind an id, an element or a stale copy; `undefined` when nothing answers (the root included). */
  resolveElement(value: ElementRef | undefined): SceneElement | undefined {
    const scene = this.scene;
    if (!scene || !value) return undefined;
    if (typeof value === 'string') return scene.elementsById.get(value);
    if (isRootElement(value)) return undefined;
    const candidate = value as { id?: string; kind?: string };
    const found = candidate.id ? scene.elementsById.get(candidate.id) : undefined;
    if (found) return found;
    return candidate.kind === 'node' || candidate.kind === 'edge' || candidate.kind === 'label' ? (value as SceneElement) : undefined;
  }

  /** What the view shows: the drilled-into container, else the document root. */
  getRoot(): Root {
    return this.scene?.scope ?? this.requireScene().rootElement;
  }

  /** The nearest collapsed container `element` lives in, else the document root. */
  rootOf(element: ElementRef): Root | undefined {
    const scene = this.scene;
    if (!scene) return undefined;
    if (isRootElement(element)) return element;
    const target = this.resolveElement(element);
    if (!target) return undefined;
    const owner = target.kind === 'label' ? target.owner : target;
    for (let p = owner.parent; p; p = p.parent) if (isCollapsed(p)) return p;
    return scene.rootElement;
  }

  // --- drill-down scope -------------------------------------------------------------

  getScope(): SceneNode | undefined {
    return this.scene?.scope;
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
    const scene = this.requireScene();
    const path: Root[] = [];
    for (let p = scene.scope; p; p = p.parent) if (isExpandable(p.type)) path.unshift(p);
    path.unshift(scene.rootElement);
    return path;
  }

  private setScope(node: SceneNode | undefined): boolean {
    const scene = this.scene;
    if (!scene || scene.scope === node) return false;
    this.resetInteraction();
    scene.scope = node;
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
    if (!this.scene) return;
    const visible = this.all().filter((element) => !isHidden(element, this.scene?.scope));
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

  /** The drawing as a standalone SVG string: chrome stripped, framed on the content. */
  toSVG(): string {
    const doc = ownerDocument();
    const copy = this.root.cloneNode(true) as SVGSVGElement;
    copy.removeAttribute('tabindex');
    copy.removeAttribute('data-gesture');
    copy.removeAttribute('data-connect-status');
    copy.removeAttribute('class');
    copy.setAttribute('class', 'sf-canvas');
    for (const stray of Array.from(copy.querySelectorAll(`[data-layer="selection"], [${CUSTOM_LAYER_ATTRIBUTE}], .${OUTLINE_CLASS}`))) {
      stray.parentNode?.removeChild(stray);
    }
    const overlays = copy.querySelector('[data-layer="overlays"]');
    while (overlays?.firstChild) overlays.removeChild(overlays.firstChild);
    for (const selected of Array.from(copy.querySelectorAll('.selected'))) selected.classList.remove('selected');
    const framed = this.exportBounds();
    if (framed) {
      copy.setAttribute('viewBox', `${framed.x} ${framed.y} ${framed.width} ${framed.height}`);
      copy.setAttribute('width', String(framed.width));
      copy.setAttribute('height', String(framed.height));
    }
    const view = (doc.defaultView ?? (typeof window !== 'undefined' ? window : undefined)) as (Window & typeof globalThis) | undefined;
    if (view && typeof view.XMLSerializer === 'function') return new view.XMLSerializer().serializeToString(copy);
    return copy.outerHTML ?? '';
  }

  private exportBounds(): Bounds | undefined {
    if (!this.scene) return undefined;
    const layer = this.layers.getLayer('elements') as SVGGElement & { getBBox?: () => DOMRect };
    let box: Bounds | undefined;
    if (typeof layer.getBBox === 'function') {
      try {
        const rect = layer.getBBox();
        if (rect.width > 0 || rect.height > 0) box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      } catch {
        box = undefined;
      }
    }
    box ??= boundsOf(this.all().filter((element) => !isHidden(element, this.scene?.scope)));
    if (!box) return undefined;
    return {
      x: box.x - EXPORT_MARGIN,
      y: box.y - EXPORT_MARGIN,
      width: Math.max(1, box.width + EXPORT_MARGIN * 2),
      height: Math.max(1, box.height + EXPORT_MARGIN * 2),
    };
  }

  // --- drawing ----------------------------------------------------------------------

  /** Draw what a commit did: erase what it removed, mount what it added, redraw what it changed, keep the paint order. */
  private drawCommit({ added, changed, removed }: Commit): void {
    if (removed.length > 0) this.eraseRemoved(removed);
    for (const element of added) this.mount(element);
    this.redrawElements(changed.filter((element): element is SceneElement => !isRootElement(element)));
    this.restack();
  }

  /** Erase what a commit removed, and let go of it: the label editor, the hover, the markers, the selection. */
  private eraseRemoved(removed: readonly Drawable[]): void {
    const gone = new Set(removed.map((element) => element.id));
    const session = this.labelEditing.getSession();
    if (session && gone.has(session.element.id)) this.labelEditing.cancel();
    const hovered = this.selection.getHovered();
    if (hovered && gone.has(hovered.id)) this.selection.setHovered(undefined);
    for (const element of removed) {
      this.renderer.erase(element.id);
      this.renderer.erase(labelIdOf(element));
      this.selection.forget(element.id);
    }
    const selected = this.selection.get();
    const keep = selected.filter((element) => !gone.has(element.kind === 'label' ? element.owner.id : element.id));
    if (keep.length < selected.length) this.selection.select(keep.length > 0 ? keep : null);
  }

  /** Keep the elements layer in paint order (`zRankOf`): a commit that moves shapes into or out of a container re-sorts it. */
  private restack(): void {
    const scene = this.scene;
    if (!scene) return;
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
    if (!scene) return;
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
    if (!scene) return null;
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
    return this.scene ? hitTest(this.scene, point, options) : undefined;
  }

  /** The selected shapes and captions a move carries. */
  private movableSelection(): Movable[] {
    return this.selection.get().filter((e): e is Movable => e.kind !== 'edge');
  }

  private requireScene(): Scene {
    if (!this.scene) throw new Error('@behaverse/studyflow-canvas: no diagram imported yet');
    return this.scene;
  }

  // --- create / connect ----------------------------------------------------------------

  createShape(descriptor: ShapeDescriptor | CreatePrototype): CreatePrototype {
    return createShape(descriptor);
  }

  /** Begin a create drag from the palette; `event` may originate outside the canvas. */
  startCreate(event: MouseEvent | undefined, descriptor: ShapeDescriptor | CreatePrototype): boolean {
    if (!this.scene) return false;
    return this.gestures.startCreate(event, createShape(descriptor));
  }

  /** Place a shape centred on `center`; `undefined` when the rules refuse. */
  createElement(descriptor: ShapeDescriptor | CreatePrototype, center: Point): SceneNode | undefined {
    const node = this.create.createAt(createShape(descriptor), center);
    if (node) this.placed(node);
    return node;
  }

  /** Add a shape the host built (a template's inner flow) at `bounds` inside `parent`, as is: no rules, no selection, no label editor. */
  addElement(descriptor: ShapeDescriptor, bounds: Bounds, parent?: SceneNode): SceneNode | undefined {
    return this.mutator?.addShape({ ...descriptor, bounds, ...(parent ? { parent } : {}) });
  }

  /** A freshly created shape: selected, and (for a task-like shape) named. */
  private placed(node: SceneNode): void {
    this.selection.select(node);
    if (EDIT_ON_CREATE_TYPES.has(node.type) || isCollapsed(node)) this.labelEditing.activate(node);
  }

  startConnect(source: SceneNode, event?: MouseEvent): boolean {
    if (!this.scene) return false;
    return this.gestures.startConnect(source, event);
  }

  /**
   * Connect `source` to `target` as the rules allow; `businessObject` is one the host built (a template's named flow),
   * and `waypoints` the route it drew, else the flow is routed.
   */
  connectElements(source: SceneNode | SceneEdge, target: SceneNode, businessObject?: ModdleObject, waypoints?: Point[]): SceneEdge | undefined {
    const edge = this.connect.connect(source, target, businessObject, waypoints);
    if (edge) this.selection.select(edge);
    return edge;
  }

  /** Click-append: place `descriptor` beside `source` and connect the two, as one edit. */
  appendElement(source: SceneNode | SceneEdge, descriptor: ShapeDescriptor | CreatePrototype): SceneNode | undefined {
    if (!this.scene) return undefined;
    const prototype = createShape(descriptor);
    if (!this.rules.canAppendType(source, prototype.type)) return undefined;
    const result = this.batch(() => autoPlaceAppend(this, source, prototype));
    if (!result) return undefined;
    if (result.connection) this.selection.select(result.shape);
    return result.shape;
  }

  /** Whether a shape at `bounds` would land on a shape or across a flow. */
  isAreaOccupied(bounds: Bounds, from?: SceneNode | SceneEdge): boolean {
    if (!this.scene) return false;
    const origin = from ? centerOf(appendSourceBounds(from)) : undefined;
    const onNode = nodesIntersecting(this.scene, bounds).some((node) => {
      if (node === from) return false;
      if (!isContainerNode(node)) return true;
      return origin !== undefined && !pointInBox(origin, node);
    });
    if (onNode) return true;
    return edgesIntersecting(this.scene, bounds).some((edge) => edge !== from);
  }

  /** Retype `node` in place, keeping its name, position and flows, as one edit. */
  replaceElement(node: SceneNode, descriptor: ShapeDescriptor | CreatePrototype): SceneNode | undefined {
    const mutator = this.mutator;
    if (!this.scene || !mutator) return undefined;
    const prototype = createShape(descriptor);
    if (!this.rules.canReplace(node, prototype.type)) return undefined;
    if (prototype.type === node.type && prototype.extensionType === getExtensionType(node.businessObject)
      && eventDefinitionTypeOf(prototype.attrs as never) === eventDefinitionTypeOf(node.businessObject)) return undefined;
    const sameCategory = categoryOf(prototype.type) === categoryOf(node.type);
    const size = sameCategory ? { width: node.width, height: node.height } : defaultSizeFor(prototype.type, prototype.isExpanded);
    const bounds: Bounds = {
      x: node.x + node.width / 2 - size.width / 2,
      y: node.y + node.height / 2 - size.height / 2,
      width: size.width,
      height: size.height,
    };
    const name = prop(node.businessObject, 'name');
    const attrs = { ...prototype.attrs, ...(typeof name === 'string' && name ? { name } : {}) };
    const parent = node.parent ?? this.scene.scope;
    const replacement = mutator.batch(() => {
      const shape = mutator.addShape({
        type: prototype.type,
        bounds,
        ...(parent ? { parent } : {}),
        ...(prototype.extensionType ? { extensionType: prototype.extensionType } : {}),
        ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
        ...(prototype.isExpanded !== undefined ? { isExpanded: prototype.isExpanded } : {}),
      });
      for (const edge of [...node.incoming]) mutator.reconnect(edge, { target: shape });
      for (const edge of [...node.outgoing]) mutator.reconnect(edge, { source: shape });
      this.deleteElements([node]);
      this.rerouteEdges([shape]);
      return shape;
    });
    this.selection.select(replacement);
    return replacement;
  }

  /** Ghost what appending `descriptor` from `source` would create; returns its bounds. */
  previewAppend(source: SceneNode | SceneEdge, descriptor: ShapeDescriptor | CreatePrototype): Bounds | undefined {
    this.clearAppendPreview();
    if (!this.scene) return undefined;
    const prototype = createShape(descriptor);
    if (!this.rules.canAppendType(source, prototype.type)) return undefined;
    const bounds = boundsFor(prototype, freeAppendPosition(
      appendSourceBounds(source), prototype, prototype.type, (area) => this.isAreaOccupied(area, source),
    ));
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
    const mutator = this.mutator;
    if (!mutator || index < 0 || index >= edge.waypoints.length) return;
    const at = this.snapPoint(point);
    mutator.setEdgeWaypoints(edge, edge.waypoints.map((p, i) => (i === index ? at : p)));
  }

  // --- edits --------------------------------------------------------------------------------

  setExpanded(node: SceneNode, expanded: boolean): boolean {
    const mutator = this.mutator;
    if (!mutator) return false;
    return mutator.setExpanded(node, expanded).changed.length > 0;
  }

  toggleExpanded(node: SceneNode): boolean {
    return this.setExpanded(node, node.isExpanded === false);
  }

  canExpand(node: SceneNode): boolean {
    return isExpandable(node.type);
  }

  setColor(elements: ElementRef | readonly ElementRef[], colors: ElementColors): SceneElement[] {
    return this.mutator?.setColor(this.resolveElements(elements), colors) ?? [];
  }

  /** Restyle captions: an omitted field is left alone, a falsy one clears; a label restyles the element it names. */
  setFont(elements: ElementRef | readonly ElementRef[], font: FontPatch): SceneElement[] {
    return this.mutator?.setFont(this.resolveElements(elements), font) ?? [];
  }

  private resolveElements(elements: ElementRef | readonly ElementRef[]): SceneElement[] {
    return (Array.isArray(elements) ? elements : [elements])
      .map((el) => this.resolveElement(el))
      .filter((el): el is SceneElement => !!el);
  }

  /** Write `properties` on an element's business object (or on the root's) and record the edit. */
  updateProperties(element: SceneElement | RootElement, properties: Record<string, unknown>): void {
    const target = this.resolveElement(element);
    this.updateModdleProperties(element, target?.businessObject ?? element.businessObject, properties);
  }

  /**
   * Write `properties` on any moddle object reachable from `element` and record the edit (core's `AttributeUpdater`).
   * A caption stands for the element it names; anything else not on the canvas records the edit on the root.
   */
  updateModdleProperties(element: ElementRef, moddle: object, properties: Record<string, unknown>): void {
    const mutator = this.mutator;
    const scene = this.scene;
    if (!mutator || !scene) return;
    const moddleElement = moddle as ModdleObject;
    for (const [key, value] of Object.entries(properties)) {
      if (prop(moddleElement, key) !== value) setProp(moddleElement, key, value);
    }
    const target = this.resolveElement(element);
    if (target) mutator.touch(drawnFrom(scene, target.kind === 'label' ? target.owner : target, moddleElement, properties));
    else mutator.record(scene.rootElement);
  }

  resizeShape(node: SceneNode, bounds: Bounds): void {
    this.mutator?.setNodeBounds(node, bounds);
  }

  /** Re-route the edges docked to `nodes`, and commit. */
  rerouteEdges(nodes: readonly SceneNode[]): SceneEdge[] {
    const mutator = this.mutator;
    if (!this.scene || !mutator) return [];
    const changed = rerouteEdgeSet(edgesAffectedBy(nodes), { obstacles: this.routeObstacles(), scope: this.scene.scope });
    mutator.commit(changed);
    return changed;
  }

  private routeObstacles(exclude: readonly SceneNode[] = []): Bounds[] {
    if (!this.scene) return [];
    const skip = new Set<SceneNode>(exclude);
    return orderedNodes(this.scene)
      .filter((node) => !skip.has(node) && !isContainerNode(node))
      .map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height }));
  }

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
    const all = this.all().filter((element) => element.kind !== 'label' && !isHidden(element, this.scene?.scope));
    if (all.length === 0) return false;
    this.selection.select(all);
    return true;
  }

  deleteSelection(): SceneElement[] {
    return this.deleteElements(this.selection.get());
  }

  /** Delete `elements` and their closure, as one edit; a caption deletes its owner's name instead. */
  deleteElements(elements: SceneElement | readonly SceneElement[]): SceneElement[] {
    const mutator = this.mutator;
    if (!mutator) return [];
    const list = Array.isArray(elements) ? (elements as readonly SceneElement[]).slice() : [elements as SceneElement];
    const drawables = list.filter((element): element is Drawable => element.kind !== 'label');
    return mutator.batch(() => {
      for (const label of list) {
        if (label.kind === 'label' && !drawables.includes(label.owner)) mutator.setName(label.owner, '');
      }
      return drawables.length > 0 ? mutator.deleteElements(drawables).removed : [];
    });
  }

  /** Make every edit `edit` makes one commit: one revision, one `ElementsChanged`, one undo step. */
  batch<T>(edit: () => T): T {
    return this.mutator ? this.mutator.batch(edit) : edit();
  }
}

/** What draws something of `moddle` once `properties` are written on it: `target`, and whatever else shows it. */
function drawnFrom(scene: Scene, target: Drawable, moddle: ModdleObject, properties: Record<string, unknown>): Drawable[] {
  // A participant's name is drawn on every choreography task it takes a band of, not only where it was edited.
  if (target.kind === 'node' && moddle.$type === 'bpmn:Participant' && 'name' in properties) {
    return tasksReferencing(scene, moddle, target);
  }
  const drawn = new Set<Drawable>([target]);
  // A flow draws its source's `default` as a slash, so a new default redraws every flow that leaves the source.
  const source = scene.byBusinessObject.get(moddle);
  if ('default' in properties && source?.kind === 'node') for (const edge of source.outgoing) drawn.add(edge);
  // A step may draw what the data it reads holds (a glyph a Parameters object sets).
  if (target.kind === 'node' && isDataShape(target.type)) for (const step of stepsReading(scene, target)) drawn.add(step);
  return [...drawn];
}

/** Every step whose data inputs read `source`. */
function stepsReading(scene: Scene, source: SceneNode): SceneNode[] {
  const out: SceneNode[] = [];
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'node' || element === source) continue;
    const associations = (prop(element.businessObject, 'dataInputAssociations') ?? []) as ModdleObject[];
    if (associations.some((association) => ((prop(association, 'sourceRef') ?? []) as unknown[]).includes(source.businessObject))) {
      out.push(element);
    }
  }
  return out;
}
