/**
 * @behaverse/studyflow-canvas — editable SVG canvas for studyflow diagrams.
 *
 * Vanilla TS + SVG DOM; no bpmn-js / diagram-js. See the architecture design for
 * the module layout and phasing. P1 exposes the scene model, the read-only
 * renderer, the viewport/layers, and the top-level `Canvas` facade; richer surface
 * (interactions, writeback, EditorPort adapter) lands in later phases.
 */

// --- Scene model ------------------------------------------------------------
export type {
  Scene,
  Plane,
  SceneElement,
  SceneElementBase,
  SceneElementKind,
  SceneNode,
  SceneEdge,
  SceneLabel,
  ModdleObject,
  Point,
  Bounds,
} from './model/scene.ts';

export { importDefinitions, type ImportOptions } from './model/import.ts';
export { IdGenerator, prefixFor } from './model/ids.ts';

export {
  Writeback,
  syncNodeBoundsToDi,
  syncEdgeWaypointsToDi,
  syncLabelBoundsToDi,
  translateLabel,
  dockConnectedEdges,
  type PartialBounds,
  type ElementChangedEvent,
  type ElementsChangedEvent,
} from './model/writeback.ts';

// --- Rendering --------------------------------------------------------------
export {
  create as svgCreate,
  attr as svgAttr,
  append as svgAppend,
  group as svgGroup,
  transform as svgTransform,
  clear as svgClear,
  setDocument,
  ownerDocument,
  SVG_NS,
} from './render/svg.ts';

export {
  drawEvent,
  drawTask,
  drawDiamond,
  drawDataObject,
  drawDataStore,
  drawGroup,
  drawTextAnnotation,
  drawParticipant,
  bandPath,
  choreographyBandHeight,
  CORNER_RADIUS,
  type ShapeStyle,
  type EventKind,
} from './render/shapes.ts';

export {
  drawIcon,
  drawSvgPaths,
  drawIconText,
  SVG_ICON_PATHS,
  MARKER_ICONS,
  type IconResolver,
  type SvgIconDef,
} from './render/icons.ts';

export {
  fit,
  wrap,
  drawInternalLabel,
  drawExternalLabel,
  externalLabelBounds,
  LABEL_FONT,
  LABEL_LINE_HEIGHT,
} from './render/labels.ts';

export {
  Renderer,
  categoryOf,
  ensureArrowMarkers,
  markerIdFor,
  type NodeCategory,
  type RendererOptions,
} from './render/renderer.ts';

// --- Viewport ---------------------------------------------------------------
export { Viewport, sceneBounds, type Viewbox } from './view/viewport.ts';
export { Layers, LAYER_ORDER, type LayerName } from './view/layers.ts';

// --- Events -----------------------------------------------------------------
export { EventBus, type EventListener } from './events/bus.ts';

// --- Interaction ------------------------------------------------------------
export {
  hitTest,
  hitTestDom,
  orderedNodes,
  orderedEdges,
  pointInNode,
  isContainerNode,
  nodesIntersecting,
  distanceToPolyline,
  normalizeRect,
  type HitOptions,
} from './interaction/hit.ts';

export {
  Selection,
  RESIZE_HANDLES,
  type ResizeHandle,
  type SelectionOptions,
  type SelectionChangedEvent,
  type HandleHit,
  type WaypointHit,
} from './interaction/selection.ts';

export {
  Drag,
  dockingPoint,
  snapTo,
  withDescendants,
  DEFAULT_GRID_SIZE,
  DEFAULT_MIN_SIZE,
  type DragKind,
  type DragOptions,
} from './interaction/drag.ts';

export {
  LabelEditing,
  choreographyBandAt,
  ensureChoreographyParticipants,
  isChoreographyTask,
  labelBounds,
  nameOf,
  readChoreographyBands,
  DEFAULT_BOTTOM,
  DEFAULT_TOP,
  type ActivateOptions,
  type DirectEditingEvent,
  type ElementDblClickEvent,
  type LabelBand,
  type LabelEditingOptions,
  type LabelEditingSession,
} from './interaction/labelEditing.ts';

// --- Facade -----------------------------------------------------------------
export { Canvas, type CanvasOptions } from './Canvas.ts';
