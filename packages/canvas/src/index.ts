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
/** One definition of containment depth — paint order, hit priority and mount agree on it. */
export { depthOf } from './model/tree.ts';

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
  ensureOutline,
  outlineSpecFor,
  OUTLINE_CLASS,
  OUTLINE_OFFSET,
  OUTLINE_RADIUS,
  type OutlineSpec,
} from './render/outline.ts';

export {
  drawEvent,
  eventRadius,
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
  drawCssIcon,
  drawSvgPaths,
  drawIconText,
  SVG_ICON_PATHS,
  MARKER_ICONS,
  type CssIconDef,
  type IconDef,
  type IconResolver,
  type SvgIconDef,
} from './render/icons.ts';

export {
  fit,
  wrap,
  drawInternalLabel,
  drawExternalLabel,
  drawEdgeLabel,
  edgeLabelBounds,
  edgeLabelTextBounds,
  externalLabelBounds,
  externalLabelTextBounds,
  labelIdOf,
  measureLabelWidth,
  flowLabelPosition,
  waypointsMid,
  FLOW_LABEL_INDENT,
  EDGE_LABEL_FONT_SIZE,
  EXTERNAL_LABEL_CLASS,
  EXTERNAL_LABEL_FONT_SIZE,
  LABEL_CLASS,
  LABEL_FONT,
  LABEL_LINE_HEIGHT,
} from './render/labels.ts';

export {
  ExternalLabels,
  hasExternalLabel,
  isLabelElement,
  labelBoundsOf,
  labelOwnerOf,
} from './model/externalLabel.ts';

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
export { injectCanvasStyles, CANVAS_CSS, CANVAS_STYLE_ID } from './view/theme.ts';

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
  resizeHandleRect,
  RESIZE_HANDLES,
  type ResizeHandle,
  type SelectionOptions,
  type SelectionChangedEvent,
  type HandleHit,
  type WaypointHit,
} from './interaction/selection.ts';

export {
  collectSnapTargets,
  snapMove,
  snapPoint,
  snapValue,
  SNAP_TOLERANCE,
  type SnapKind,
  type SnapResult,
  type SnapTargets,
} from './interaction/snapping.ts';

export {
  Drag,
  dockingPoint,
  snapTo,
  withDescendants,
  DEFAULT_GRID_SIZE,
  DEFAULT_MIN_SIZE,
  type DragKind,
  type DragOptions,
  type MinSize,
} from './interaction/drag.ts';

export {
  LabelEditing,
  choreographyBandAt,
  editorBounds,
  labelBounds,
  labelPlacement,
  type LabelPlacement,
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

// --- EditorPort adapter (design §3 `port/adapter.ts`, §4) --------------------
export {
  createCanvasEditorPort,
  type CanvasEditorPort,
  type CanvasPortDeps,
  type CanvasPortHistory,
  type PortElement,
  type PortElements,
  type PortEventListener,
  type PortEvents,
  type PortGestures,
  type PortModdle,
  type PortModel,
  type PortModelElement,
  type PortMutations,
  type PortPopup,
  type PortRect,
  type PortRoot,
  type PortRules,
  type PortSelection,
  type PortSimulation,
  type PortTemplates,
  type PortView,
  type PortViewbox,
} from './port/adapter.ts';
