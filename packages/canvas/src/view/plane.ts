/**
 * Sub-process drill-down — the CURRENT-PLANE view cursor
 * (`scratchpad/subprocess-drilldown-spec.md`, frames `edge-videos/sub/*`).
 *
 * The scene has always modelled nested planes: `model/import.ts` builds one
 * {@link Plane} per `bpmndi:BPMNDiagram`, and a collapsed sub-process that carries
 * its own diagram owns a plane whose children live in their own coordinate space.
 * What the canvas lacked is a *cursor*: "which plane am I looking at right now".
 * `Scene.rootPlane` cannot answer that — it is the DOCUMENT root, and
 * `model/writeback.ts` / `model/remove.ts` both key off it — so the cursor lives
 * here, beside the viewport, and drives the editor through exactly two public seams:
 *
 * - {@link Canvas.setPlaneScope} — "only these elements exist right now": anything
 *   the predicate rejects is neither drawn nor hit-tested;
 * - {@link Canvas.redrawElements} / {@link Canvas.zoomToFit} — repaint and refit.
 *
 * **Navigation is VIEW-ONLY** (drill-down spec, plan §5-D5). Nothing here calls
 * `Writeback`, bumps `Scene.revision`, records history or touches a moddle object,
 * so a round trip through a sub-plane re-serializes byte-identically.
 *
 * The ONE piece of scene state it does touch is deliberate and reversible:
 * `SceneNode.isExpanded` of the containers on the path *into* the current plane is
 * flipped to `true` for as long as the cursor sits inside them. That flag is what
 * `model/expand.ts isHiddenByCollapse` derives visibility and hit-testing from, and
 * being *inside* a container is precisely the state "open" describes. It is scene
 * state only — the backing `bpmndi:BPMNShape.isExpanded` is never written (that is
 * `Writeback.setExpanded`'s job) — and {@link PlaneCursor.goToPlane} restores the
 * previous value on the way out.
 *
 * The drill-down badge (`sub/frame_10`) is drawn from here into a custom overlay
 * layer supplied by the host ({@link Canvas.getHostLayer}`('drilldown', 900)`),
 * because it is view chrome with no scene element behind it. The badge is the ONLY
 * gesture that navigates: a double click belongs to `Canvas.handleDoubleClick`,
 * which toggles the container in place. The two used to fight over the same event —
 * this module settled it in the capture phase for a collapsed, planed container and
 * let it through for everything else, which is exactly how one sub-process came to
 * drill and its neighbour to expand.
 *
 * Not every container the badge appears on owns a plane. One whose children are
 * filed in the parent plane is entered through a SYNTHESIZED scope
 * ({@link virtualPlaneOf}) — a `Plane`-shaped object that never joins
 * `Scene.planes`, so the document is navigable without being restructured.
 */

import type { Canvas } from '@canvas/Canvas.ts';
import type { EventBus } from '@canvas/events/bus.ts';
import { isExpandable, nestedPlanesOf } from '@canvas/model/expand.ts';
import { prop } from '@canvas/model/moddle.ts';
import type { ModdleObject, Plane, Scene, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import { append, clear, create, remove } from '@canvas/render/svg.ts';

// --- geometry (measured off `edge-videos/sub/frame_10` at zoom ≈ 2) ------------

/** Side of the square drill-down badge, in diagram units. */
export const DRILLDOWN_BADGE_SIZE = 20;

/** Corner radius of the badge (`rx`), in diagram units. */
export const DRILLDOWN_BADGE_RADIUS = 3;

/**
 * Where the badge sits relative to the shape's BOTTOM-RIGHT corner: mostly outside
 * the frame, overlapping it slightly on x — the frame shows the badge's left edge
 * 13 units inside the shape's right edge and its top 6 units below the bottom.
 */
export const DRILLDOWN_BADGE_OFFSET = { x: -13, y: 6 } as const;

/** diagram-js's selection blue — the badge fill (`view/theme.ts` uses the same hue). */
const BADGE_FILL = 'hsl(205, 100%, 50%)';

// --- pure plane queries --------------------------------------------------------

/**
 * The node a nested plane depicts — the sub-process (or sub-choreography) you drill
 * INTO to reach it. `undefined` for the root plane, whose business object is the
 * process/collaboration itself.
 */
export function planeOwner(scene: Scene, plane: Plane): SceneNode | undefined {
  if (isVirtualPlane(plane)) return plane.owner;
  if (plane === scene.rootPlane) return undefined;
  const element = scene.byBusinessObject.get(plane.businessObject);
  return element && element.kind === 'node' ? element : undefined;
}

/**
 * The nested plane `node` owns, if any — what a drill-down on it opens. A node may
 * legally carry more than one `BPMNDiagram`; the first in document order wins, the
 * way bpmn-js's `getPlaneIdFromShape` resolves it.
 */
export function nestedPlaneOf(scene: Scene, node: SceneNode): Plane | undefined {
  return nestedPlanesOf(scene, node)[0];
}

/**
 * Whether `node` offers a drill-down from the plane it is drawn in — TRUE for every
 * expandable container, whatever the document does with its contents and whichever
 * state it is drawn in.
 *
 * This used to require `isCollapsed(node) && nestedPlaneOf(…)`, and those two extra
 * conjuncts were the whole of the "some sub-processes drill, some don't" report:
 * `sklearn_pipeline`'s `select_model` owns a `BPMNDiagram` and got a badge, while
 * `prepare_data` — same type, contents merely filed in the parent plane — got none,
 * and an expanded container lost its badge the moment it opened. A container with no
 * plane of its own is entered through a SYNTHESIZED scope ({@link virtualPlaneOf}),
 * which is a pure view construct: nothing is added to `scene.planes`, nothing is
 * written, and the document is not restructured to make the trip possible.
 *
 * `scene` is unused now but kept in the signature: every caller has one, and the
 * moment a subclass wants a document-derived answer this is where it goes.
 */
export function isDrillable(_scene: Scene, node: SceneNode): boolean {
  return isExpandable(node.type);
}

// --- synthesized scopes ---------------------------------------------------------

/**
 * A view scope around a container that owns no `bpmndi:BPMNDiagram` — shaped like a
 * {@link Plane} so breadcrumbs, `elements.root()`, `goToPlane` and the badge painter
 * all keep working, but deliberately NEVER pushed into `Scene.planes`, so
 * `nestedPlanesOf`, `model/remove.ts`, export scoping and the importer never see a
 * plane the document does not have.
 */
export interface VirtualPlane extends Plane {
  /** The container this scope stands for. */
  readonly owner: SceneNode;
}

/** Whether `plane` is a synthesized scope rather than a real `bpmndi:BPMNPlane`. */
export function isVirtualPlane(plane: Plane): plane is VirtualPlane {
  return (plane as VirtualPlane).owner !== undefined;
}

const virtualPlanes = new WeakMap<SceneNode, VirtualPlane>();

/**
 * The memoized synthesized scope for `node` — memoized for identity, because
 * `rootOf` and `Canvas.goToPlane` compare plane objects, and refreshed on every call
 * because the container's child list is rebuilt by create and delete.
 */
export function virtualPlaneOf(node: SceneNode): VirtualPlane {
  let plane = virtualPlanes.get(node);
  if (!plane) {
    plane = {
      id: `${node.id}__scope`,
      businessObject: node.businessObject,
      di: node.di ?? node.businessObject,
      children: node.children,
      owner: node,
    };
    virtualPlanes.set(node, plane);
  }
  plane.children = node.children;
  plane.businessObject = node.businessObject;
  plane.di = node.di ?? node.businessObject;
  return plane;
}

/** Whether `element` sits anywhere under `node` in the scene containment tree. */
export function isDescendantOf(element: SceneElement, node: SceneNode): boolean {
  const guard = new Set<SceneNode>();
  let cursor = element.parent;
  while (cursor && !guard.has(cursor)) {
    if (cursor === node) return true;
    guard.add(cursor);
    cursor = cursor.parent;
  }
  return false;
}

/**
 * Whether `element` belongs to the view scope `plane` stands for — the ONE predicate
 * behind what is drawn, what is hit-tested and which nodes wear a badge, so a real
 * plane and a synthesized one cannot drift apart.
 */
export function inScopeOf(scene: Scene, plane: Plane, element: SceneElement): boolean {
  if (isVirtualPlane(plane)) return element !== plane.owner && isDescendantOf(element, plane.owner);
  return planeOf(scene, element) === plane;
}

/**
 * The plane `element` is drawn in. Every plane lists its own top-level elements, so
 * the answer is "the plane that lists me, or the one that lists my nearest ancestor"
 * — which is what puts an inline-expanded sub-process's children in the PARENT plane
 * and a drilled-down one's children in their own.
 */
export function planeOf(scene: Scene, element: SceneElement): Plane {
  const direct = directPlanes(scene);
  const guard = new Set<SceneElement>();
  let cursor: SceneElement | undefined = element;
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const plane = direct.get(cursor);
    if (plane) return plane;
    cursor = cursor.parent;
  }
  return scene.rootPlane;
}

/** Root → `plane`, the trail a breadcrumb renders (a single entry at the root). */
export function planePathOf(scene: Scene, plane: Plane): Plane[] {
  const path: Plane[] = [];
  const guard = new Set<Plane>();
  let cursor: Plane | undefined = plane;
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    path.unshift(cursor);
    const owner = planeOwner(scene, cursor);
    cursor = owner ? planeOf(scene, owner) : undefined;
  }
  return path;
}

/**
 * `element → the plane that lists it directly`, memoized per scene revision. Rebuilt
 * rather than maintained: a plane's `children` array is re-assembled by create and
 * delete, and every one of those bumps `Scene.revision`.
 */
const directIndex = new WeakMap<Scene, { revision: number; map: Map<SceneElement, Plane> }>();

function directPlanes(scene: Scene): Map<SceneElement, Plane> {
  const cached = directIndex.get(scene);
  if (cached && cached.revision === scene.revision) return cached.map;
  const map = new Map<SceneElement, Plane>();
  for (const plane of scene.planes) {
    for (const child of plane.children) if (!map.has(child)) map.set(child, plane);
  }
  directIndex.set(scene, { revision: scene.revision, map });
  return map;
}

// --- the plane as an element ---------------------------------------------------

/**
 * A plane, projected onto the shape of a scene element.
 *
 * App code reads `editor.elements.root()` for the diagram name, for export scoping
 * and as the inspector's fallback selection. A `bpmndi:BPMNPlane` is exactly that,
 * but it is not a {@link SceneElement} — so it is projected onto one here (`id`,
 * `type`, `businessObject`, `di`, `children`) and memoized per plane, so identity
 * comparisons (`e.element === editor.elements.root()`) hold.
 */
export interface PlaneRoot {
  id: string;
  type: string;
  readonly isRoot: true;
  businessObject: ModdleObject;
  di: ModdleObject;
  children: SceneElement[];
  parent: undefined;
  plane: Plane;
}

const roots = new WeakMap<Plane, PlaneRoot>();

/** The memoized {@link PlaneRoot} projection of `plane`. */
export function rootOf(plane: Plane): PlaneRoot {
  let root = roots.get(plane);
  if (!root) {
    root = {
      id: String(prop(plane.businessObject, 'id') ?? plane.id),
      type: plane.businessObject.$type,
      isRoot: true,
      businessObject: plane.businessObject,
      di: plane.di,
      children: plane.children,
      parent: undefined,
      plane,
    };
    roots.set(plane, root);
  }
  // The projection is memoized for identity (`e.element === elements.root()`), but
  // everything it mirrors can move underneath it: the child list is rebuilt on
  // create/delete, and dropping the first pool REPLACES the business object the
  // plane depicts (`Writeback.promoteRootToCollaboration`). So refresh, never rebuild.
  root.children = plane.children;
  root.businessObject = plane.businessObject;
  root.di = plane.di;
  root.id = String(prop(plane.businessObject, 'id') ?? plane.id);
  root.type = plane.businessObject.$type;
  return root;
}

/** Whether `value` is a plane projection rather than a real scene element. */
export function isPlaneRoot(value: unknown): value is PlaneRoot {
  return !!value && (value as PlaneRoot).isRoot === true;
}

/** The label a drill-down badge shows for `node` — its name, else its id. */
export function nodeName(node: SceneNode): string {
  const name = prop(node.businessObject, 'name');
  if (typeof name === 'string' && name.trim()) return name;
  return node.id;
}

// --- the cursor ----------------------------------------------------------------

/** Construction dependencies for {@link PlaneCursor}. */
export interface PlaneCursorOptions {
  /** The canvas being navigated. */
  canvas: Canvas;
  /**
   * The `<g>` the drill-down badges are drawn into, resolved lazily on every paint
   * — an import drops custom layers, and the host re-attaches on the next call.
   */
  layer: () => SVGElement;
  /** Called after the cursor moved, so the host can fire `root.set` for the new plane. */
  onChange?: (plane: Plane) => void;
}

/**
 * The current-plane cursor: which plane the editor is looking at, how to get to
 * another one, and the badges that offer the trip.
 */
export class PlaneCursor {
  private readonly canvas: Canvas;
  private readonly layerOf: () => SVGElement;
  private readonly onChange?: (plane: Plane) => void;
  private readonly bus: EventBus;

  /** The scene the cursor was last synced against — a re-import resets everything. */
  private scene?: Scene;
  private plane?: Plane;
  /**
   * `isExpanded` as the DOCUMENT left it, for every container the cursor opened on
   * its way in. Restored on the way out; never written to DI.
   */
  private readonly opened = new Map<SceneNode, boolean | undefined>();
  /** The `<g>` holding this cursor's badges, re-attached whenever the layer is dropped. */
  private badgeGroup?: SVGGElement;
  private destroyed = false;

  constructor(options: PlaneCursorOptions) {
    this.canvas = options.canvas;
    this.layerOf = options.layer;
    this.onChange = options.onChange;
    this.bus = options.canvas.getEventBus();
    // BOTH topics. `Writeback.finish` fires `elements.changed` only for a BATCH, so
    // watching the plural alone missed every single-element edit — including the one
    // that matters most here, a palette drop of a sub-process, whose badge would then
    // not appear until something else happened to change.
    this.bus.on('element.changed', this.onElementsChanged);
    this.bus.on('elements.changed', this.onElementsChanged);
    this.bus.on('import.done', this.onImportDone);
    // Badges are shown only for SELECTED containers, so they come and go with the
    // selection, not just with the document.
    this.bus.on('selection.changed', this.onSelectionChanged);
  }

  /** The plane currently rendered — the root plane until a drill-down moves it. */
  current(): Plane | undefined {
    this.sync();
    return this.plane;
  }

  /** Root → current, for the breadcrumb trail. Empty before the first import. */
  planePath(): Plane[] {
    this.sync();
    const scene = this.scene;
    const plane = this.plane;
    return scene && plane ? planePathOf(scene, plane) : [];
  }

  /** Whether the view is anywhere other than the document root. */
  isDrilledDown(): boolean {
    this.sync();
    return !!this.plane && !!this.scene && this.plane !== this.scene.rootPlane;
  }

  /**
   * Enter `node`'s contents. Returns whether the view moved.
   *
   * A container that owns a `bpmndi:BPMNDiagram` opens THAT plane; one whose children
   * are filed in the parent plane opens a SYNTHESIZED scope over them
   * ({@link virtualPlaneOf}) — same breadcrumb, same "only these elements exist"
   * restriction, same authoring target — because which of the two shapes a document
   * happens to use is not something the user should have to know. Nothing is written
   * either way. A non-expandable node has no contents to enter and is refused.
   */
  enterPlane(node: SceneNode): boolean {
    this.sync();
    const scene = this.scene;
    if (!scene || !isExpandable(node.type)) return false;
    // A real plane that holds nothing while the node HAS children means the
    // contents were authored inline, in the parent plane, while the container was
    // drawn expanded — opening the empty plane would show none of them, so the
    // synthesized scope over the children is where the trip actually goes.
    const plane = nestedPlaneOf(scene, node);
    const usable = plane && (plane.children.length > 0 || node.children.length === 0)
      ? plane
      : undefined;
    return this.goToPlane(usable ?? virtualPlaneOf(node));
  }

  /** Show `plane` (real or synthesized). Returns whether the view moved. */
  goToPlane(plane: Plane): boolean {
    this.sync();
    const scene = this.scene;
    if (!scene || this.plane === plane) return false;
    if (!scene.planes.includes(plane) && !isVirtualPlane(plane)) return false;

    this.plane = plane;
    this.applyPlane(scene, plane);
    this.canvas.zoomToFit();
    this.onChange?.(plane);
    return true;
  }

  /** Re-paint the drill-down badges for the current plane. */
  refresh(): void {
    this.sync();
    this.drawBadges();
  }

  /** Drop the listeners and the badges; leaves the document untouched. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.bus.off('element.changed', this.onElementsChanged);
    this.bus.off('elements.changed', this.onElementsChanged);
    this.bus.off('import.done', this.onImportDone);
    this.bus.off('selection.changed', this.onSelectionChanged);
    remove(this.badgeGroup);
    this.badgeGroup = undefined;
  }

  // --- internals ---------------------------------------------------------------

  /** Re-base on the live scene; a fresh import puts the cursor back at the root. */
  private sync(): void {
    const scene = this.canvas.getScene();
    if (scene === this.scene) return;
    this.scene = scene;
    this.plane = scene?.rootPlane;
    // The nodes in `opened` belong to the previous scene: their flags went with it.
    this.opened.clear();
    this.canvas.setActivePlane(undefined);
    this.canvas.setActiveContainer(undefined);
    this.drawBadges();
  }

  /**
   * Point the editor at `plane`: open the containers on the way in, close the ones
   * left behind, scope the view to the plane's own elements, and repaint.
   */
  private applyPlane(scene: Scene, plane: Plane): void {
    const path = planePathOf(scene, plane);
    const owners = new Set<SceneNode>();
    for (const step of path) {
      const owner = planeOwner(scene, step);
      if (owner) owners.add(owner);
    }
    // Close what we came out of, first: a container that is no longer on the path
    // goes back to exactly the flag the document gave it.
    for (const [node, was] of [...this.opened]) {
      if (owners.has(node)) continue;
      node.isExpanded = was;
      this.opened.delete(node);
    }
    // …then open what we went into. Being INSIDE a container is what makes its
    // contents visible; nothing is written to `node.di`.
    for (const owner of owners) {
      if (!this.opened.has(owner)) this.opened.set(owner, owner.isExpanded);
      owner.isExpanded = true;
    }

    const scoped = plane === scene.rootPlane
      ? undefined
      : (element: SceneElement): boolean => inScopeOf(scene, plane, element);
    this.canvas.setPlaneScope(scoped);
    // What is DRAWN and what is MADE move together: a palette drop while drilled in
    // belongs to the plane on screen, not to the document root (`Canvas.setActivePlane`).
    //
    // A SYNTHESIZED scope splits the two halves of that. Its contents' DI is filed in
    // a REAL plane — the one the container itself is drawn in — so that is what the
    // active plane must be, while the container is the active CONTAINER, which is
    // where a drop's business object goes (`flowElements`). Setting the virtual plane
    // as the active one would file `planeElement` entries into an object the document
    // does not contain.
    const virtual = isVirtualPlane(plane) ? plane : undefined;
    const real = virtual ? planeOf(scene, virtual.owner) : plane;
    this.canvas.setActivePlane(real === scene.rootPlane ? undefined : real);
    this.canvas.setActiveContainer(virtual?.owner);
    // `setPlaneScope` hides what left the scope and redraws what re-entered it, but
    // an element can also change visibility WITHOUT changing scope: everything in a
    // freshly opened container was `display:none` a moment ago. Redraw the whole
    // plane — never anything outside it, whose graphics the scope has just hidden
    // and whose re-draw would put it back on screen.
    const inScope: SceneElement[] = [];
    for (const element of scene.elementsById.values()) {
      if (element.kind !== 'node' && element.kind !== 'edge') continue;
      if (!scoped || scoped(element)) inScope.push(element);
    }
    this.canvas.redrawElements(inScope);
    this.drawBadges();
  }

  /**
   * Draw one badge per SELECTED drillable node of the current scope; clear the
   * rest. Selection-gated so the canvas stays free of chrome until the user is
   * looking at a particular container.
   */
  private drawBadges(): void {
    if (this.destroyed) return;
    const group = this.badges();
    clear(group);
    const scene = this.scene;
    const plane = this.plane;
    if (!scene || !plane) return;
    const selection = this.canvas.getSelection();
    for (const element of scene.elementsById.values()) {
      if (element.kind !== 'node') continue;
      if (!selection.isSelected(element)) continue;
      if (!isDrillable(scene, element)) continue;
      if (!inScopeOf(scene, plane, element)) continue;
      append(group, this.badge(element));
    }
  }

  private badges(): SVGGElement {
    const layer = this.layerOf();
    let group = this.badgeGroup;
    if (!group) {
      group = create('g', { class: 'sf-drilldowns' }) as SVGGElement;
      this.badgeGroup = group;
    }
    if (group.parentNode !== layer) append(layer, group);
    return group;
  }

  /**
   * One badge: a blue rounded square with a white ↘, anchored off the shape's
   * bottom-right corner (`sub/frame_10`). Styled with attributes rather than
   * `view/theme.ts` — it is host chrome in a host-owned layer, and the theme sheet
   * knows nothing about it.
   */
  private badge(node: SceneNode): SVGGElement {
    const size = DRILLDOWN_BADGE_SIZE;
    const x = node.x + node.width + DRILLDOWN_BADGE_OFFSET.x;
    const y = node.y + node.height + DRILLDOWN_BADGE_OFFSET.y;
    const label = `Open ${nodeName(node)}`;
    const g = create('g', {
      class: 'sf-drilldown',
      'data-drilldown': node.id,
      transform: `translate(${x}, ${y})`,
      cursor: 'pointer',
      // BOTH spellings on purpose. A `<title>` child is how an SVG node names itself
      // to a browser (it is what paints the native tooltip) — but Playwright's
      // `getByTitle` matches the ATTRIBUTE, and that locator is the drill-down's only
      // handle in the e2e suite (`tests/modeler.execution.spec.ts`).
      title: label,
      'aria-label': label,
    }) as SVGGElement;
    const title = create('title');
    title.textContent = label;
    append(g, title);
    append(g, create('rect', {
      width: size,
      height: size,
      rx: DRILLDOWN_BADGE_RADIUS,
      ry: DRILLDOWN_BADGE_RADIUS,
      fill: BADGE_FILL,
    }));
    append(g, create('path', {
      d: 'M 6 6 L 13.5 13.5 M 13.5 8.5 L 13.5 13.5 L 8.5 13.5',
      fill: 'none',
      stroke: '#ffffff',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }));
    const enter = (ev: Event): void => {
      // The badge sits over the shape it belongs to: without this the canvas would
      // read the same press as "select the sub-process" and, on a double click, as
      // "toggle it open" — a DOCUMENT edit, which navigation must never be.
      ev.stopPropagation();
      ev.preventDefault();
      this.enterPlane(node);
    };
    g.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    });
    g.addEventListener('click', enter);
    g.addEventListener('dblclick', enter);
    return g;
  }

  /** The selection moved: the badges follow it. */
  private readonly onSelectionChanged = (): void => {
    if (this.destroyed) return;
    this.drawBadges();
  };

  /** Geometry moved or an element came and went: the badges follow. */
  private readonly onElementsChanged = (): void => {
    if (this.destroyed) return;
    this.sync();
    this.refreshOpened();
    this.rehideOutOfScope();
    this.drawBadges();
  };

  /**
   * Re-read the `isExpanded` the DOCUMENT holds for every container the cursor
   * opened on its way in.
   *
   * The cursor forces `SceneNode.isExpanded` true while you are inside a container
   * and restores the remembered value on the way out. Now that a toggle is reachable
   * from the context pad *while drilled in*, that remembered value can go stale — and
   * restoring it would silently revert a genuine `Writeback.setExpanded`. The DI flag
   * is the document's own answer, so take it from there.
   */
  private refreshOpened(): void {
    if (this.opened.size === 0) return;
    for (const node of [...this.opened.keys()]) {
      const flag = node.di ? prop(node.di, 'isExpanded') : undefined;
      this.opened.set(node, typeof flag === 'boolean' ? flag : undefined);
    }
  }

  private readonly onImportDone = (): void => {
    if (this.destroyed) return;
    this.sync();
  };

  /**
   * A re-draw derives `display` from the collapse state alone, so an element OUTSIDE
   * the current plane that something re-drew would pop back into view. Put it back.
   */
  private rehideOutOfScope(): void {
    const scope = this.canvas.getPlaneScope();
    const scene = this.scene;
    if (!scope || !scene) return;
    for (const element of scene.elementsById.values()) {
      if (element.kind !== 'node' && element.kind !== 'edge') continue;
      if (scope(element)) continue;
      this.canvas.getGraphics(element.id)?.setAttribute('display', 'none');
    }
  }
}

