/**
 * The canvas: owns the scene, the SVG, the viewport, the renderer and the
 * interaction modules, and is the API the host talks to.
 */

import { BPMN } from '@core/constants.ts';
import { getExtensionType } from '@core/element/index.ts';
import { EventBus } from '@core/events/bus.ts';

import { appendElement as autoPlaceAppend, appendSourceBounds, freeAppendPosition } from '@canvas/interaction/autoplace.ts';
import { Connect, type ConnectionEnd } from '@canvas/interaction/connect.ts';
import { boundsFor, Create, createShape, defaultSizeFor, type CreatePrototype, type ShapeDescriptor } from '@canvas/interaction/create.ts';
import { DEFAULT_GRID_SIZE, Drag, snapTo, type Movable } from '@canvas/interaction/drag.ts';
import { Gestures, ZOOM_STEP } from '@canvas/interaction/gestures.ts';
import { edgesIntersecting, hitTest, isContainerNode, nodesIntersecting, orderedNodes, pointInNode, type HitOptions } from '@canvas/interaction/hit.ts';
import { LabelEditing } from '@canvas/interaction/labelEditing.ts';
import { EDITING_MARKER, OUTLINE_CLASS, Selection } from '@canvas/interaction/selection.ts';
import type { ParticipantBand } from '@canvas/model/choreography.ts';
import { dataAssociationEnds, isDataAssociationType } from '@canvas/model/dataAssociation.ts';
import { writeDi } from '@canvas/model/di.ts';
import { importDefinitions, type ImportOptions } from '@canvas/model/import.ts';
import { syncLabel } from '@canvas/model/labels.ts';
import { prop, setProp } from '@canvas/model/moddle.ts';
import { Mutator } from '@canvas/model/mutator.ts';
import { isRootElement, type Bounds, type ElementColors, type ModdleObject, type Point, type RootElement, type Scene, type SceneEdge, type SceneElement, type SceneNode } from '@canvas/model/scene.ts';
import { boundsOf, contentsOf, edgesAffectedBy, isCollapsed, isExpandable, isHidden, withDescendants, zRankOf } from '@canvas/model/tree.ts';
import { categoryOf } from '@canvas/render/shapes.ts';
import { edgeDashArray, ensureArrowMarkers, markerEndFor, previewEdge, Renderer, type RendererOptions } from '@canvas/render/renderer.ts';
import { append, create, ownerDocument, remove } from '@canvas/render/svg.ts';
import { centerOf } from '@canvas/routing/crop.ts';
import { rerouteEdges as rerouteEdgeSet, routableEnd, routeFor, type RouteOptions } from '@canvas/routing/orthogonal.ts';
import { CONNECTION, containerFor, Rules, type RuleElement } from '@canvas/rules/rules.ts';
import { CUSTOM_LAYER_ATTRIBUTE, Layers } from '@canvas/view/layers.ts';
import { injectCanvasStyles } from '@canvas/view/theme.ts';
import { Viewport, type Viewbox } from '@canvas/view/viewport.ts';

export interface CanvasOptions extends RendererOptions {
  /** Host element the SVG root is appended to; a detached `<div>` when omitted. */
  container?: HTMLElement;
  onWarning?: ImportOptions['onWarning'];
  snapToGrid?: boolean;
  rules?: Rules;
}

export interface CanvasViewbox extends Viewbox {
  /** The drawn diagram. */
  inner: Bounds;
  /** The container, in screen pixels. */
  outer: { width: number; height: number };
}

export type Rect = Bounds;
export type Root = RootElement | SceneNode;

const EXPORT_MARGIN = 4;

/** Shapes created unnamed and useless: their label editor opens on drop. */
const EDIT_ON_CREATE_TYPES = new Set<string>([
  BPMN.Task, BPMN.UserTask, BPMN.ServiceTask, BPMN.ScriptTask, BPMN.ManualTask, BPMN.SendTask,
  BPMN.ReceiveTask, BPMN.BusinessRuleTask, BPMN.TextAnnotation, BPMN.Group,
]);

export class Canvas {
  readonly create: Create;
  readonly connect: Connect;
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
  private readonly onWarning?: ImportOptions['onWarning'];
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
    this.onWarning = options.onWarning;
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
    this.rules = options.rules ?? new Rules();
    this.selection = new Selection({
      layer: this.layers.getLayer('selection'),
      getGraphics: (id) => this.renderer.graphicsById.get(id),
      bus: this.bus,
      root: this.root,
      canResize: (target) => target.kind === 'label' || this.rules.canResize(target),
      resolve: (value) => this.resolveElement(value),
    });
    this.labelEditing = new LabelEditing({
      container: this.container,
      viewport: this.viewport,
      bus: this.bus,
      getMutator: () => this.mutator,
      redraw: (elements) => this.redrawElements(elements),
      restoreFocus: () => this.focus(),
      setLabelHidden: (element, hidden) => {
        if (hidden) this.selection.addMarker(element.id, 'sf-label-hidden');
        else this.selection.removeMarker(element.id, 'sf-label-hidden');
      },
    });
    this.bus.on<{ element: SceneElement }>('DirectEditingActivate', ({ element }) => this.selection.addMarker(element.id, EDITING_MARKER));
    const endEditing = ({ element }: { element: SceneElement }) => this.selection.removeMarker(element.id, EDITING_MARKER);
    this.bus.on('DirectEditingComplete', endEditing);
    this.bus.on('DirectEditingCancel', endEditing);

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
    this.gestures = new Gestures(this);
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

  isDestroyed(): boolean {
    return this.destroyed;
  }

  // --- the document ---------------------------------------------------------------

  /** Build the scene from `definitions` (with DI), draw it and fit the viewport. */
  importDefinitions(definitions: ModdleObject): Scene {
    this.gestures.cancel();
    this.labelEditing.reset();
    this.selection.clear();
    this.selection.forget();
    this.selection.setHovered(undefined);
    this.scene = importDefinitions(definitions, { onWarning: this.onWarning });
    this.mutator = new Mutator(this.scene, this.bus);
    this.drag = new Drag({
      mutator: this.mutator,
      redraw: (elements) => this.redrawElements(elements),
      snapToGrid: this.snapToGrid,
      minSizeFor: (node) => this.rules.minSizeFor(node),
      obstacles: (moving) => this.routeObstacles(moving),
      getScope: () => this.scene?.scope,
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

  getMutator(): Mutator | undefined {
    return this.mutator;
  }

  getLabelEditing(): LabelEditing {
    return this.labelEditing;
  }

  /** @internal */
  getDrag(): Drag | undefined {
    return this.drag;
  }

  /** @internal */
  getOverlays(): SVGGElement {
    return this.layers.getLayer('overlays');
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

  /** The live element behind an id, an element or a stale copy; `undefined` when nothing answers. */
  resolveElement(value: unknown): SceneElement | undefined {
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
  rootOf(element: unknown): Root | undefined {
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
    this.gestures.cancel();
    this.labelEditing.reset();
    this.selection.clear();
    this.selection.setHovered(undefined);
    scene.scope = node;
    this.renderer.scope = node;
    this.redrawElements(this.all());
    this.zoomToFit();
    this.bus.fire('RootSet', { element: this.getRoot() });
    return true;
  }

  // --- view -------------------------------------------------------------------------

  zoomToFit(padding = 40): void {
    if (!this.scene) return;
    const visible = this.all().filter((element) => !isHidden(element, this.scene?.scope));
    this.viewport.fitBounds(boundsOf(visible) ?? { x: 0, y: 0, width: 1000, height: 1000 }, padding);
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
  getAbsoluteBBox(element: unknown): Rect {
    const target = this.resolveElement(element);
    return this.viewport.getAbsoluteBBox((target && boundsOf([target])) ?? { x: 0, y: 0, width: 0, height: 0 });
  }

  addMarker(element: unknown, marker: string): void {
    const target = this.resolveElement(element);
    if (target) this.selection.addMarker(target, marker);
  }

  removeMarker(element: unknown, marker: string): void {
    const target = this.resolveElement(element);
    if (target) this.selection.removeMarker(target, marker);
  }

  scrollToElement(element: unknown): void {
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

  isSnapToGrid(): boolean {
    return this.snapToGrid;
  }

  /** @internal */
  snapPoint(point: Point): Point {
    if (!this.snapToGrid) return { ...point };
    return { x: snapTo(point.x, DEFAULT_GRID_SIZE), y: snapTo(point.y, DEFAULT_GRID_SIZE) };
  }

  /** @internal */
  viewportCentre(): Point {
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

  /** Re-draw `elements` (and their captions) from the scene, then refresh the selection chrome. */
  redrawElements(elements: readonly SceneElement[]): void {
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
        const labelId = `${element.id}_label`;
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
    this.selection.refresh();
  }

  /** @internal Draw a new element into the elements layer at its z-rank. */
  mount(element: SceneElement): SVGGElement {
    const g = this.renderer.draw(element);
    const layer = this.layers.getLayer('elements');
    const owner = element.kind === 'label' ? this.renderer.graphicsById.get(element.owner.id) : undefined;
    if (owner?.parentNode === layer) layer.insertBefore(g, owner.nextSibling);
    else layer.insertBefore(g, this.firstAbove(layer, element));
    this.renderer.graphicsById.set(element.id, g);
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

  /** @internal The selected shapes and captions a move carries. */
  movableSelection(): Movable[] {
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

  /** @internal A freshly created shape: drawn, selected, and (for a task-like shape) named. */
  placed(node: SceneNode): void {
    this.mount(node);
    this.selection.select(node);
    if (EDIT_ON_CREATE_TYPES.has(node.type) || isCollapsed(node)) this.labelEditing.activate(node);
  }

  startConnect(source: SceneNode, event?: MouseEvent): boolean {
    if (!this.scene) return false;
    return this.gestures.startConnect(source, event);
  }

  connectElements(source: SceneNode | SceneEdge, target: SceneNode): SceneEdge | undefined {
    const edge = this.connect.connect(source, target);
    if (!edge) return undefined;
    this.mount(edge);
    this.selection.select(edge);
    return edge;
  }

  /** Click-append: place `descriptor` beside `source` and connect the two. */
  appendElement(source: SceneNode | SceneEdge, descriptor: ShapeDescriptor | CreatePrototype): SceneNode | undefined {
    if (!this.scene) return undefined;
    const prototype = createShape(descriptor);
    if (!this.rules.canAppendType(source, prototype.type)) return undefined;
    const result = autoPlaceAppend(this, source, prototype);
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
      return origin !== undefined && !pointInNode(origin, node);
    });
    if (onNode) return true;
    return edgesIntersecting(this.scene, bounds).some((edge) => edge !== from);
  }

  /** Retype `node` in place, keeping its name, position and flows. */
  replaceElement(node: SceneNode, descriptor: ShapeDescriptor | CreatePrototype): SceneNode | undefined {
    const mutator = this.mutator;
    if (!this.scene || !mutator) return undefined;
    const prototype = createShape(descriptor);
    if (!this.rules.canReplace(node, prototype.type)) return undefined;
    if (prototype.type === node.type && prototype.extensionType === getExtensionType(node.businessObject)) return undefined;
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
    const replacement = mutator.addShape({
      type: prototype.type,
      bounds,
      ...(node.parent ?? this.scene.scope ? { parent: node.parent ?? this.scene.scope } : {}),
      ...(prototype.extensionType ? { extensionType: prototype.extensionType } : {}),
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
      ...(prototype.isExpanded !== undefined ? { isExpanded: prototype.isExpanded } : {}),
    });
    for (const edge of [...node.incoming]) mutator.reconnect(edge, { target: replacement });
    for (const edge of [...node.outgoing]) mutator.reconnect(edge, { source: replacement });
    this.deleteElements([node]);
    this.mount(replacement);
    this.rerouteEdges([replacement]);
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

  hasAppendPreview(): boolean {
    return this.appendPreview !== undefined;
  }

  reconnectElement(edge: SceneEdge, end: ConnectionEnd, node: SceneNode): boolean {
    if (!this.connect.reconnect(edge, end, node)) return false;
    this.redrawElements([edge]);
    return true;
  }

  /** @internal Move one waypoint and commit it. */
  moveWaypoint(edge: SceneEdge, index: number, point: Point): void {
    const mutator = this.mutator;
    if (!mutator || index < 0 || index >= edge.waypoints.length) return;
    const at = this.snapPoint(point);
    mutator.setEdgeWaypoints(edge, edge.waypoints.map((p, i) => (i === index ? at : p)));
    this.redrawElements([edge]);
  }

  // --- move drops ------------------------------------------------------------------------

  /** @internal The container a move hovering `point` would land in, and whether it may. */
  moveDropTarget(point: Point): { over?: SceneElement; parent?: SceneNode; allowed: boolean } | undefined {
    const scene = this.scene;
    if (!scene) return undefined;
    const moving = withDescendants(this.movableSelection().filter((el): el is SceneNode => el.kind === 'node'));
    if (moving.length === 0) return undefined;
    const ids = new Set(moving.map((node) => node.id));
    const over = this.hitTest(point, { accept: (el) => !ids.has(el.kind === 'label' ? el.owner.id : el.id) });
    const hit = !over || over.kind === 'label' ? undefined : over.kind === 'node' && isContainerNode(over) ? over : over.parent;
    const container = containerFor(hit) as SceneNode | undefined;
    const parent = container && container.kind === 'node' ? container : undefined;
    const roots = moving.filter((node) => !(node.parent && ids.has(node.parent.id)));
    const allowed = this.rules.canMove(roots, parent ?? (scene.scope ? { ...scene.scope, isExpanded: true } : scene.rootElement));
    return { ...(over ? { over } : {}), ...(parent ? { parent } : {}), allowed };
  }

  /** @internal The moved nodes whose container would change by landing in `parent`. */
  reparentable(parent: SceneNode | undefined): SceneNode[] {
    const selected = this.movableSelection().filter((el): el is SceneNode => el.kind === 'node');
    const set = new Set(selected);
    const target = parent ?? this.scene?.scope;
    return selected.filter((node) => !(node.parent && set.has(node.parent)) && node !== target && (node.parent ?? undefined) !== target);
  }

  /** @internal Commit a drop's containment change and re-splice graphics at their new depth. */
  reparentDropped(parent: SceneNode | undefined): void {
    const scene = this.scene;
    const mutator = this.mutator;
    const roots = this.reparentable(parent);
    if (!scene || !mutator || roots.length === 0) return;
    const changed = mutator.reparent(roots, parent ?? scene.scope);
    const moved = new Set<SceneElement>();
    const add = (element: SceneElement): void => {
      moved.add(element);
      if (element.kind === 'label') return;
      if (element.label) moved.add(element.label);
      if (element.kind === 'node') for (const edge of [...element.incoming, ...element.outgoing]) add(edge);
    };
    for (const element of changed) {
      add(element);
      if (element.kind === 'node') for (const inner of contentsOf(element)) add(inner);
    }
    const layer = this.layers.getLayer('elements');
    const ordered = [...moved]
      .map((element) => ({ element, g: this.renderer.graphicsById.get(element.id) }))
      .filter((entry): entry is { element: SceneElement; g: SVGGElement } => !!entry.g)
      .sort((a, b) => zRankOf(a.element) - zRankOf(b.element));
    for (const { g } of ordered) remove(g);
    for (const { element, g } of ordered) layer.insertBefore(g, this.firstAbove(layer, element));
  }

  // --- edits --------------------------------------------------------------------------------

  setExpanded(node: SceneNode, expanded: boolean): boolean {
    const mutator = this.mutator;
    if (!mutator) return false;
    const { changed, contents } = mutator.setExpanded(node, expanded);
    if (changed.length === 0) return false;
    this.redrawElements([...contents, ...changed]);
    return true;
  }

  toggleExpanded(node: SceneNode): boolean {
    return this.setExpanded(node, node.isExpanded === false);
  }

  canExpand(node: SceneNode): boolean {
    return isExpandable(node.type);
  }

  setMarkerVisible(node: SceneNode, visible: boolean): boolean {
    if (!this.mutator?.setMarkerVisible(node, visible)) return false;
    this.redrawElements([node]);
    return true;
  }

  createDataAssociation(source: SceneNode, target: SceneNode): SceneEdge | undefined {
    if (!dataAssociationEnds(source, target)) return undefined;
    const verdict = this.rules.canConnect(source, target);
    if (!verdict || !isDataAssociationType(verdict.type)) return undefined;
    return this.connectElements(source, target);
  }

  setBandName(node: SceneNode, band: ParticipantBand, name: string): boolean {
    const changed = this.mutator?.setBandName(node, band, name) ?? [];
    if (changed.length === 0) return false;
    this.redrawElements(changed);
    return true;
  }

  setInitiator(node: SceneNode, band: ParticipantBand): boolean {
    if (!this.mutator?.setInitiator(node, band)) return false;
    this.redrawElements([node]);
    return true;
  }

  swapInitiator(node: SceneNode): boolean {
    if (!this.mutator?.swapInitiator(node)) return false;
    this.redrawElements([node]);
    return true;
  }

  setColor(elements: unknown, colors: ElementColors): SceneElement[] {
    const list = (Array.isArray(elements) ? elements : [elements]).map((el) => this.resolveElement(el)).filter((el): el is SceneElement => !!el);
    const changed = this.mutator?.setColor(list, colors) ?? [];
    if (changed.length > 0) this.redrawElements(changed);
    return changed;
  }

  /** Write `properties` on an element's business object (or on the root) and record the edit. */
  updateProperties(element: unknown, properties: Record<string, unknown>): void {
    const target = this.resolveElement(element);
    const bo = (target?.businessObject ?? (element as { businessObject?: ModdleObject })?.businessObject ?? element) as ModdleObject;
    this.updateModdleProperties(element, bo, properties);
  }

  /** `AttributeUpdater` for `@core/element`: a write on any moddle object reachable from `element`. */
  update(element: unknown, target: object, properties: Record<string, unknown>): void {
    this.updateModdleProperties(element, target, properties);
  }

  /** Write `properties` on any moddle object reachable from `element` and record the edit. */
  updateModdleProperties(element: unknown, moddle: object, properties: Record<string, unknown>): void {
    const mutator = this.mutator;
    const moddleElement = moddle as ModdleObject;
    if (!mutator) return;
    let touched = false;
    for (const [key, value] of Object.entries(properties)) {
      if (prop(moddleElement, key) === value) continue;
      setProp(moddleElement, key, value);
      touched = true;
    }
    const target = this.resolveElement(element);
    if (target && target.kind !== 'label') {
      mutator.touch(target);
      if (touched) this.redrawElements([target]);
    } else {
      mutator.record(isRootElement(element) ? element : this.getRoot());
    }
  }

  resizeShape(node: SceneNode, bounds: Bounds): void {
    const changed = this.mutator?.setNodeBounds(node, bounds) ?? [];
    this.redrawElements(changed);
  }

  /** Re-route the edges `elements` (default: the selection) affect, and commit. */
  rerouteEdges(elements?: SceneElement | readonly SceneElement[], options?: RouteOptions): SceneEdge[] {
    const mutator = this.mutator;
    if (!this.scene || !mutator) return [];
    const list = elements === undefined ? this.selection.get() : Array.isArray(elements) ? (elements as readonly SceneElement[]) : [elements as SceneElement];
    const changed = rerouteEdgeSet(edgesAffectedBy(list), { obstacles: this.routeObstacles(), scope: this.scene.scope, ...options });
    if (changed.length > 0) {
      mutator.commit(changed);
      this.redrawElements(changed);
    }
    return changed;
  }

  private routeObstacles(exclude: readonly SceneNode[] = []): Bounds[] {
    if (!this.scene) return [];
    const skip = new Set<SceneNode>(exclude);
    return orderedNodes(this.scene)
      .filter((node) => !skip.has(node) && !isContainerNode(node))
      .map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height }));
  }

  /** @internal */
  nudgeSelection(dx: number, dy: number): boolean {
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

  /** Delete `elements` and their closure; a caption deletes its owner's name instead. */
  deleteElements(elements: SceneElement | readonly SceneElement[]): SceneElement[] {
    const mutator = this.mutator;
    if (!mutator || !this.scene) return [];
    const list = Array.isArray(elements) ? (elements as readonly SceneElement[]).slice() : [elements as SceneElement];
    const drawables = list.filter((element) => element.kind !== 'label');
    for (const label of list) {
      if (label.kind === 'label' && !drawables.includes(label.owner) && mutator.setName(label.owner, '')) {
        this.redrawElements([label.owner]);
      }
    }
    if (drawables.length === 0) return [];
    const session = this.labelEditing.getSession();
    const { removed, changed } = mutator.deleteElements(drawables);
    if (removed.length === 0) return [];
    if (session && removed.includes(session.element)) this.labelEditing.cancel();
    const removedIds = new Set(removed.map((element) => element.id));
    const hovered = this.selection.getHovered();
    if (hovered && removedIds.has(hovered.id)) this.selection.setHovered(undefined);
    const keep = this.selection.get().filter((element) => (
      !removedIds.has(element.id) && !(element.kind === 'label' && removedIds.has(element.owner.id))
    ));
    for (const element of removed) {
      this.renderer.erase(element.id);
      this.renderer.erase(`${element.id}_label`);
      this.selection.forget(element.id);
    }
    this.selection.select(keep.length > 0 ? keep : null);
    this.redrawElements(changed);
    return removed;
  }
}
