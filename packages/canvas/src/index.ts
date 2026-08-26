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
  asList,
  asModdle,
  definitionsAbove,
  listProp,
  mint,
  modelOf,
  nameOf,
  parentOf,
  prop,
  pullFrom,
  pushInto,
  refBO,
  refBOs,
  setProp,
  setRef,
  unfile,
  type ModdleFactory,
} from './model/moddle.ts';

export {
  Writeback,
  definitionsOf,
  flowContainerOf,
  containmentPropertyFor,
  syncNodeBoundsToDi,
  syncEdgeWaypointsToDi,
  syncLabelBoundsToDi,
  translateLabel,
  dockConnectedEdges,
  type AddShapeSpec,
  type AddConnectionSpec,
  type AddDataAssociationSpec,
  type FlowContainer,
  type ReconnectEnds,
  type PartialBounds,
  type ExpandedResult,
  type ElementChangedEvent,
  type ElementsChangedEvent,
} from './model/writeback.ts';

export {
  applyBandName,
  applyInitiator,
  ensureChoreographyParticipants,
  isChoreographyTask,
  isChoreographyType,
  participantRefs,
  readChoreographyBands,
  tasksReferencing,
  DEFAULT_BOTTOM,
  DEFAULT_TOP,
  type BandWrite,
  type ChoreographyBands,
  type ParticipantBand,
} from './model/choreography.ts';

export {
  applyColors,
  normalizeColor,
  normalizeColors,
  readColors,
  readColorsOf,
  COLOR_PROPERTIES,
  type ElementColors,
} from './model/color.ts';

export {
  activityOf,
  dataAssociationEnds,
  directionOf,
  isDataAssociationType,
  pruneDataAssociation,
  typeForDirection,
  wireDataAssociation,
  DATA_INPUT_ASSOCIATION,
  DATA_OUTPUT_ASSOCIATION,
  type DataAssociationDirection,
  type DataAssociationEnds,
} from './model/dataAssociation.ts';

export {
  applyExpanded,
  applyMarkerVisible,
  contentsOf,
  expandedFootprintOf,
  isCollapsed,
  isExpandable,
  isExpanded,
  isHiddenByCollapse,
  nestedPlanesOf,
  rememberExpandedFootprint,
  COLLAPSED_SUBPROCESS_SIZE,
  EXPANDABLE_TYPES,
  type ExpandPlan,
  type SetExpandedOptions,
} from './model/expand.ts';

export {
  deleteElements,
  collectRemoval,
  type DeleteResult,
  type ElementsRemovedEvent,
} from './model/remove.ts';

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
  labelBounds,
  type ActivateOptions,
  type DirectEditingEvent,
  type ElementDblClickEvent,
  type LabelBand,
  type LabelEditingOptions,
  type LabelEditingSession,
} from './interaction/labelEditing.ts';

export {
  Create,
  createShape,
  boundsFor,
  defaultSizeFor,
  DEFAULT_SIZES,
  EXPANDED_SUBPROCESS_SIZE,
  type CreateOptions,
  type CreatePrototype,
  type DropTarget,
  type ShapeDescriptor,
} from './interaction/create.ts';

export {
  Connect,
  type ConnectionEnd,
  type ConnectOptions,
} from './interaction/connect.ts';

// --- Rules ------------------------------------------------------------------
export {
  Rules,
  defaultRules,
  canContain,
  structuralConnection,
  defaultConnectionType,
  bpmnTypeOf,
  typeRefOf,
  participantOf,
  containerOf,
  containerFor,
  isDataShape,
  isResizable,
  minSizeFor,
  CONNECTION,
  MIN_SIZES,
  FALLBACK_MIN_SIZE,
  type ConnectionSpec,
  type RuleContext,
  type RuleElement,
  type RuleVerdict,
  type RulesOptions,
  type Size,
} from './rules/rules.ts';

// --- Routing ----------------------------------------------------------------
export {
  route,
  routeCenters,
  routeEdge,
  rerouteEdge,
  rerouteEdges,
  edgesAffectedBy,
  isOrthogonal,
  DEFAULT_CLEARANCE,
  DEFAULT_STRAIGHT_TOLERANCE,
  type RouteOptions,
  type RoutableShape,
} from './routing/orthogonal.ts';

export {
  cropWaypoints,
  cropPoint,
  outlinePoint,
  outlineFor,
  containsPoint,
  centerOf,
  type CroppableShape,
  type Outline,
} from './routing/crop.ts';

// --- Facade -----------------------------------------------------------------
export { Canvas, type CanvasOptions } from './Canvas.ts';
