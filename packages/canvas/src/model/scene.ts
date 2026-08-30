/**
 * Scene model — the lightweight scene graph the canvas builds once at import and
 * writes through to the live DI moddle objects on every edit (design §1 option
 * (c), §3 "Scene model").
 *
 * Each element is intentionally shaped like the editor facade's `EditorElement`
 * (`packages/modeler/src/editor/port.ts`): `id`, `type`, `businessObject`, `di`,
 * `x`/`y`/`width`/`height` (nodes) or `waypoints` (edges), `source`, `target`,
 * `parent`, `label`, `incoming`/`outgoing`. Aligning the two is what lets the
 * facade hand these elements OUT unchanged, with no projection in between.
 *
 * P1 (read-only renderer) uses these types verbatim; downstream stages
 * (`model/import.ts`, `model/writeback.ts`, `render/*`) add the logic. This file
 * is TYPES ONLY — no runtime code.
 */

/**
 * A schema-aware moddle object as produced by `bpmn-moddle` — a business object
 * (`bpmn:*`), a DI element (`bpmndi:*` / `dc:*` / `di:*`), or an extension. The
 * canvas mutates these in place so `bpmn-moddle` re-emits the edited document and
 * the `.studyflow` inline-DI folding picks the change up (design §1).
 */
export type ModdleObject = {
  readonly $type: string;
  id?: string;
  [key: string]: unknown;
};

/** A plain 2D point in diagram (untransformed) coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** An axis-aligned rectangle in diagram coordinates. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Discriminates the members of {@link SceneElement}. */
export type SceneElementKind = 'node' | 'edge';

/**
 * Fields shared by every scene element. `type` is the business-object `$type`
 * (e.g. `'bpmn:UserTask'`, `'bpmn:SequenceFlow'`); `businessObject` is the BO and
 * `di` its backing `bpmndi:BPMNShape` / `bpmndi:BPMNEdge` moddle object.
 */
export interface SceneElementBase {
  readonly id: string;
  readonly kind: SceneElementKind;
  type: string;
  businessObject: ModdleObject;
  di?: ModdleObject;
  /** Containing node (subprocess/participant/plane-root), or `undefined` at the plane root. */
  parent?: SceneNode;
  /** External or internal label placement, when the element carries one. */
  label?: SceneLabel;
  /**
   * Set only on the synthetic elements `model/externalLabel.ts` mints for an
   * external label: the element the label names. Its presence is what makes an
   * element A LABEL (diagram-js spells the same field `labelTarget`), and it is how
   * selection, outlining, deletion and the inline editor tell the caption apart from
   * the shape it hangs off.
   */
  labelTarget?: SceneElement;
}

/**
 * A shape: event, activity/task, gateway, data object, choreography task, group,
 * participant/lane, text annotation. Geometry mirrors the backing
 * `di.bounds` (`dc:Bounds`); writeback keeps the two in sync.
 */
export interface SceneNode extends SceneElementBase {
  readonly kind: 'node';
  x: number;
  y: number;
  width: number;
  height: number;
  /** Nodes nested inside this one (expanded subprocess, participant lanes, plane children). */
  children: SceneElement[];
  /** Edges whose `target` is this node. */
  incoming: SceneEdge[];
  /** Edges whose `source` is this node. */
  outgoing: SceneEdge[];
  /** Subprocess expanded state (`BPMNShape.isExpanded`). */
  isExpanded?: boolean;
  /** Gateway marker visibility (`BPMNShape.isMarkerVisible`). */
  isMarkerVisible?: boolean;
}

/**
 * A connection: sequence flow, message flow, association, data association.
 * `waypoints` mirrors the backing `di.waypoint` (`di:Waypoint[]`).
 */
export interface SceneEdge extends SceneElementBase {
  readonly kind: 'edge';
  waypoints: Point[];
  source?: SceneNode;
  target?: SceneNode;
}

/** Either kind of drawable scene element. */
export type SceneElement = SceneNode | SceneEdge;

/**
 * A label overlaid on (internal) or placed beside (external) an element. Carries
 * its own bounds from `bpmndi:BPMNLabel.bounds` when the DI positions it
 * explicitly; otherwise the renderer derives placement.
 */
export interface SceneLabel {
  readonly id: string;
  readonly kind: 'label';
  /** The label text source — the owner's `businessObject.name`. */
  businessObject: ModdleObject;
  /** Backing `bpmndi:BPMNLabel`, when present. */
  di?: ModdleObject;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** The node or edge this label belongs to. */
  owner: SceneElement;
}

/**
 * One `bpmndi:BPMNPlane` and the tree of elements it depicts. The root plane is a
 * process/collaboration/choreography; nested planes back expanded subprocesses and
 * choreography sub-planes (design §1 "Nested planes").
 */
export interface Plane {
  readonly id: string;
  /** Root business object the plane depicts (`plane.bpmnElement`). */
  businessObject: ModdleObject;
  /** The `bpmndi:BPMNPlane` moddle object. */
  di: ModdleObject;
  /** Top-level elements of this plane, in document order. */
  children: SceneElement[];
}

/**
 * The whole importable diagram: every plane plus flat indexes for O(1) hit-testing,
 * selection, and writeback joins (`id → element`, `businessObject → element`).
 * `revision` is a monotonically increasing mutation counter the app reads for the
 * facade's `revision`/history (design §4).
 */
export interface Scene {
  planes: Plane[];
  /**
   * The document's own root plane — the process/collaboration diagram, never the
   * plane a drill-down is currently *showing*. Which plane is displayed is a view
   * concern (`view/plane.ts` `PlaneCursor`), not a property of the model.
   */
  rootPlane: Plane;
  /** All elements and labels keyed by id. */
  elementsById: Map<string, SceneElement | SceneLabel>;
  /** Reverse lookup from a business object to its scene element. */
  byBusinessObject: Map<ModdleObject, SceneElement | SceneLabel>;
  revision: number;
}
