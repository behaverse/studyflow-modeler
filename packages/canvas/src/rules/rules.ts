/**
 * Rules — the canvas's single answer to "may this edit happen?" (design §3
 * "Rules", §6 P4).
 *
 * Two layers — the schema's own `meta.connectsTo` allow-list (evaluated through
 * `TypeCatalog.connectionRule`, `packages/core/src/notation/query.ts`) over plain
 * structural BPMN sense. Nothing here is a wrapper: the schema half is consumed
 * straight from `@behaverse/studyflow-core`, the structural half is expressed
 * against the static BPMN type hierarchy `@core/notation/bpmn` already publishes.
 *
 * They are consulted in that precedence order (which is why the ported rules used
 * to register at priority 1500, above the structural ones at 1000):
 *
 * 1. **Schema layer** — `catalog.connectionRule(sourceRef, targetRef)` returns
 *    `true` / `false` / `'defer'`. A `false` vetoes outright; a `true` wins over
 *    the structural layer (the schema author took responsibility); `'defer'`
 *    (the source declares no `connectsTo`, which is the case for every *shipped*
 *    schema today) hands the decision to the structural layer.
 * 2. **Structural layer** — plain BPMN sense: nothing flows out of an end event
 *    or into a start event, no self-loop unless opted in, sequence flow only
 *    within one participant/container, message flow only across a participant
 *    boundary, associations for artifacts, data associations for data shapes.
 *
 * Everything here is pure and side-effect free — the same verdict function backs
 * the connect/create gestures, the context-pad append menu, and the
 * facade's `Editor.rules`, whose `allowed(action, context): boolean` shape
 * {@link Rules.allowed} deliberately mirrors (a truthy {@link ConnectionSpec} or
 * `'attach'` collapses to `true` under the facade's `!!`).
 */

import { getExtensionType } from '@core/element/index.ts';
import { isBpmnSubtypeOf } from '@core/notation/bpmn.ts';
import { getCatalog, hasCatalog } from '@core/notation/index.ts';
import type { TypeCatalog } from '@core/notation/query.ts';
import type { Bounds, ModdleObject } from '@canvas/model/scene.ts';

// --- inputs -----------------------------------------------------------------

/**
 * The structural minimum a rule needs to judge an element. `SceneNode`,
 * `SceneEdge` and `Plane` all satisfy it as-is, and so does a *detached* palette
 * shape that has no scene identity yet (`{ type: 'bpmn:Task' }`) — which is the
 * whole point: `shape.create` is asked before the element exists.
 */
export interface RuleElement {
  /** The business-object `$type` (`'bpmn:UserTask'`), when already known. */
  readonly type?: string;
  /** The backing business object; its `$type` is the fallback for {@link bpmnTypeOf}. */
  readonly businessObject?: ModdleObject;
  /** Containing node — walked to find the participant / flow-element container. */
  readonly parent?: RuleElement;
  /** Contained elements — read only to tell an empty diagram root from a populated one. */
  readonly children?: readonly unknown[];
  /** Connection source (edges only). */
  readonly source?: RuleElement;
  /** Connection target (edges only). */
  readonly target?: RuleElement;
  /** Connections arriving at this shape — read by {@link Rules.canMove}. */
  readonly incoming?: readonly RuleElement[];
  /** Connections leaving this shape — read by {@link Rules.canMove}. */
  readonly outgoing?: readonly RuleElement[];
  /** Subprocess/participant expanded state; `false` means a collapsed frame. */
  readonly isExpanded?: boolean;
}

/** Free-form rule context, mirroring diagram-js's `rules.allowed(action, context)`. */
export type RuleContext = Record<string, unknown>;

/** An allowed connection, and the BPMN type the gesture layer should mint. */
export interface ConnectionSpec {
  type: string;
}

/**
 * What a rule answers with. `false` vetoes; `true` allows; a
 * {@link ConnectionSpec} allows *and* names the connection type to create;
 * `'attach'` allows as a boundary attachment rather than as containment.
 */
export type RuleVerdict = boolean | 'attach' | ConnectionSpec;

/** A width/height floor, as returned by {@link minSizeFor}. */
export interface Size {
  width: number;
  height: number;
}

/** Tuning knobs; every field has a documented default. */
export interface RulesOptions {
  /**
   * Catalog to read `meta.connectsTo` from. Defaults to the installed catalog
   * (`getCatalog()`); when no catalog is installed at all the schema layer is
   * simply skipped (every pair defers to the structural layer).
   */
  catalog?: TypeCatalog;
  /**
   * Whether a node may connect to itself. Default `false` — a studyflow loop is
   * modelled through a gateway, not a self-edge. A schema `connectsTo` that
   * names the source's own type still wins, like any other schema `true`.
   */
  allowSelfLoop?: boolean;
  /** Per-BPMN-type width/height floors overriding {@link MIN_SIZES}. */
  minSizes?: Readonly<Record<string, Size>>;
}

// --- BPMN type predicates ---------------------------------------------------

/** The connection types the rules can ask for. */
export const CONNECTION = {
  sequenceFlow: 'bpmn:SequenceFlow',
  messageFlow: 'bpmn:MessageFlow',
  association: 'bpmn:Association',
  dataInputAssociation: 'bpmn:DataInputAssociation',
  dataOutputAssociation: 'bpmn:DataOutputAssociation',
} as const;

/**
 * Data shapes: they carry data associations, never sequence flow.
 *
 * The single definition of the set — the rules mint associations to these types,
 * `render/renderer.ts` categorizes them as `'data'` and `routing/crop.ts` therefore
 * crops to a page/cylinder outline. When the three disagreed, a `bpmn:DataStore`
 * was a legal association end that drew as an anonymous rectangle.
 */
export const DATA_TYPES: ReadonlySet<string> = new Set([
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:DataObject',
  'bpmn:DataStore',
]);

/** The data shapes drawn (and cropped) as a cylinder rather than a dog-eared page. */
export const DATA_STORE_TYPES: ReadonlySet<string> = new Set([
  'bpmn:DataStoreReference',
  'bpmn:DataStore',
]);

/**
 * Whether `type` is a data shape — the ends a data association attaches to
 * (`model/dataAssociation.ts` sorts a pair by this exact predicate, so the create
 * path and the rule that allowed it cannot disagree).
 */
export function isDataShape(type: string): boolean {
  return DATA_TYPES.has(type);
}

/** Whether `type` is a data STORE — {@link DATA_STORE_TYPES}, drawn as a cylinder. */
export function isDataStore(type: string): boolean {
  return DATA_STORE_TYPES.has(type);
}

/** `bpmn:Group` / `bpmn:TextAnnotation` — framed commentary, wired with associations. */
function isArtifact(type: string): boolean {
  return isBpmnSubtypeOf(type, 'bpmn:Artifact');
}

/** Containers that own `flowElements` (a lane owns none, but hosts the pool's). */
function isFlowContainer(type: string): boolean {
  return type === 'bpmn:Process'
    || type === 'bpmn:Participant'
    || type === 'bpmn:Lane'
    || isBpmnSubtypeOf(type, 'bpmn:SubProcess');
}

/**
 * The business-object `$type` of an element, as a `bpmn:*` name. A studyflow
 * palette type (`studyflow:Instruction`) is mapped through the catalog's
 * `bpmnTypeOf`, so callers may pass either.
 */
export function bpmnTypeOf(element: RuleElement | undefined, catalog?: TypeCatalog): string {
  const raw = element?.type ?? (element?.businessObject?.$type as string | undefined);
  if (!raw) return '';
  if (raw.startsWith('bpmn:')) return raw;
  return catalog?.bpmnTypeOf(raw) ?? raw;
}

/**
 * The type reference the *schema* rule is keyed by: the element's extension type
 * (`studyflow:Instruction`) when it carries one, else its BPMN type. Mirrors
 * `typeRefOf` in `packages/modeler/src/bpmn/behaviors.ts`.
 */
export function typeRefOf(element: RuleElement | undefined): string | undefined {
  if (!element) return undefined;
  const bo = element.businessObject;
  const extensionType = bo ? getExtensionType(bo) : undefined;
  return extensionType ?? element.type ?? (bo?.$type as string | undefined);
}

// --- scope walking ----------------------------------------------------------

/** Guard against a malformed parent chain (a cycle would otherwise hang a gesture). */
const MAX_DEPTH = 64;

/**
 * The pool an element sits in, or `undefined` in a plain (pool-less) process.
 * Two elements with *different, both-defined* participants are separated by a
 * participant boundary — the message-flow test.
 */
export function participantOf(element: RuleElement | undefined): RuleElement | undefined {
  let current = element;
  for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    if (bpmnTypeOf(current) === 'bpmn:Participant') return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * The nearest flow-element container (pool or subprocess) an element belongs to;
 * `undefined` at the plane root. Lanes and groups are *visual* nesting only —
 * their contents belong to the enclosing pool/process — so both are skipped.
 * Sequence flow is legal only inside one container.
 *
 * Named for its layer on purpose: `model/import.ts` walks the *moddle* tree
 * (`moddleContainerOf`) and `interaction/create.ts` resolves a *hit* to a container
 * node — three different questions that used to share the name `containerOf`.
 */
export function ruleContainerOf(element: RuleElement | undefined): RuleElement | undefined {
  let current = element?.parent;
  for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    const type = bpmnTypeOf(current);
    if (type !== 'bpmn:Lane' && type !== 'bpmn:Group') return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * The element that would really *own* a shape dropped onto `parent`. A
 * `bpmn:Group` is an artifact and owns no `flowElements`, so a drop on a group
 * is judged — and written back — against the group's own container.
 */
export function containerFor(parent: RuleElement | undefined): RuleElement | undefined {
  let current = parent;
  for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    if (bpmnTypeOf(current) !== 'bpmn:Group') return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * The flow-element container a drop ON `target` lands in — {@link ruleContainerOf}
 * asked of the target ITSELF rather than of its parent, so the two answers can be
 * compared. A plane root (a `bpmn:Process` / `bpmn:Collaboration`) is `undefined`,
 * which is what `ruleContainerOf` reports for the shapes drawn there.
 */
export function dropContainerOf(target: RuleElement | undefined): RuleElement | undefined {
  let current = target;
  for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    const type = bpmnTypeOf(current);
    if (type === 'bpmn:Process' || type === 'bpmn:Collaboration') return undefined;
    if (type !== 'bpmn:Lane' && type !== 'bpmn:Group') return current;
    current = current.parent;
  }
  return undefined;
}

// --- resize -----------------------------------------------------------------

/**
 * Types the canvas lets the user resize. Ports `ResizableTasks`
 * (`bpmn/behaviors.ts:18–26`) plus what bpmn-js's own `canResize` allows:
 * activities, choreography tasks, pools, lanes, groups and text annotations.
 * Events, gateways and data shapes have a fixed footprint.
 */
const RESIZABLE_ANCESTORS: readonly string[] = [
  'bpmn:Activity',
  'bpmn:ChoreographyActivity',
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:Group',
  'bpmn:TextAnnotation',
];

export function isResizable(type: string): boolean {
  return RESIZABLE_ANCESTORS.some((ancestor) => isBpmnSubtypeOf(type, ancestor));
}

/** Floor applied to anything resizable with no more specific {@link MIN_SIZES} entry. */
export const FALLBACK_MIN_SIZE: Size = { width: 20, height: 20 };

/**
 * Width/height floors, most specific first (a `bpmn:Transaction` is a
 * `bpmn:SubProcess` is a `bpmn:Activity`, so the activity entry catches it).
 */
export const MIN_SIZES: ReadonlyArray<readonly [string, Size]> = [
  ['bpmn:Participant', { width: 300, height: 60 }],
  ['bpmn:Lane', { width: 300, height: 60 }],
  ['bpmn:TextAnnotation', { width: 50, height: 30 }],
  ['bpmn:Group', { width: 60, height: 40 }],
  ['bpmn:ChoreographyActivity', { width: 100, height: 80 }],
  ['bpmn:Activity', { width: 100, height: 80 }],
];

export function minSizeFor(type: string, overrides?: Readonly<Record<string, Size>>): Size {
  const override = overrides?.[type];
  if (override) return override;
  for (const [ancestor, size] of MIN_SIZES) {
    if (isBpmnSubtypeOf(type, ancestor)) return size;
  }
  return FALLBACK_MIN_SIZE;
}

// --- containment ------------------------------------------------------------

/**
 * Pure containment table: may a `shapeType` shape live inside a `containerType`
 * container? `'attach'` is the boundary-event answer — allowed, but as an
 * attachment to the activity rather than as a child of it.
 *
 * Note on choreographies: the app rewrites a `bpmn:Choreography` root into a
 * `bpmn:Process` before the canvas ever sees it
 * (`@core/document/choreography.ts` `choreographyToProcessRoot`), so
 * `bpmn:ChoreographyTask` must be a legal child of a plain process here.
 */
export function canContain(shapeType: string, containerType: string): boolean | 'attach' {
  if (!shapeType || !containerType) return false;

  if (isBpmnSubtypeOf(shapeType, 'bpmn:BoundaryEvent')) {
    return isBpmnSubtypeOf(containerType, 'bpmn:Activity') ? 'attach' : false;
  }

  if (containerType === 'bpmn:Collaboration') {
    return shapeType === 'bpmn:Participant' || isArtifact(shapeType);
  }

  if (containerType === 'bpmn:Choreography') {
    return isBpmnSubtypeOf(shapeType, 'bpmn:ChoreographyActivity')
      || isBpmnSubtypeOf(shapeType, 'bpmn:Event')
      || isBpmnSubtypeOf(shapeType, 'bpmn:Gateway')
      || isArtifact(shapeType);
  }

  if (isFlowContainer(containerType)) {
    // A pool is a root-level participant; it never nests in a process.
    if (shapeType === 'bpmn:Participant') return false;
    // Lanes subdivide a pool (or another lane), nothing else.
    if (shapeType === 'bpmn:Lane') return containerType === 'bpmn:Participant' || containerType === 'bpmn:Lane';
    return isBpmnSubtypeOf(shapeType, 'bpmn:FlowNode') || isDataShape(shapeType) || isArtifact(shapeType);
  }

  return false;
}

// --- connections ------------------------------------------------------------

/**
 * Can this type *emit* a message? Pools, activities and throwing events.
 *
 * These are BPMN's Collaboration rules, not the Process ones: a message flow joins
 * two PARTICIPANTS, so the pair is judged by what can throw and what can catch — an
 * end event is a throw event and may source one, a start event is a catch event and
 * may target one, and neither is legal at either end of a sequence flow. Two lanes of
 * one pool are one participant, so nothing here applies to them
 * ({@link participantOf} walks lanes through to the pool).
 */
function isMessageSource(type: string): boolean {
  return type === 'bpmn:Participant'
    || isBpmnSubtypeOf(type, 'bpmn:Activity')
    || isBpmnSubtypeOf(type, 'bpmn:ThrowEvent');
}

/** Can this type *receive* a message? Pools, activities and catching events. */
function isMessageTarget(type: string): boolean {
  return type === 'bpmn:Participant'
    || isBpmnSubtypeOf(type, 'bpmn:Activity')
    || isBpmnSubtypeOf(type, 'bpmn:CatchEvent');
}

/**
 * Can this type **consume** data — be the target of a `DataInputAssociation`? Only
 * the two BPMN types that own `dataInputAssociations`: `bpmn:Activity` and
 * `bpmn:ThrowEvent` (so an end / intermediate-throw event, never a catching one).
 * A catching event has no place to file the association, and writing one onto it
 * would land in `$attrs` and serialize as garbage.
 */
function isDataSink(type: string): boolean {
  return isBpmnSubtypeOf(type, 'bpmn:Activity') || isBpmnSubtypeOf(type, 'bpmn:ThrowEvent');
}

/**
 * Can this type **produce** data — be the source of a `DataOutputAssociation`? The
 * types that own `dataOutputAssociations`: `bpmn:Activity` and `bpmn:CatchEvent`
 * (start / intermediate-catch / boundary events).
 */
function isDataSource(type: string): boolean {
  return isBpmnSubtypeOf(type, 'bpmn:Activity') || isBpmnSubtypeOf(type, 'bpmn:CatchEvent');
}

/**
 * The BPMN-structural half of `connection.create`: the verdict the canvas would
 * reach with no schema rule in play, and the connection type to mint.
 *
 * Order matters — artifacts first (an association may cross any boundary), then
 * data associations, then the participant-boundary test that separates message
 * flow from sequence flow.
 */
export function structuralConnection(
  source: RuleElement | undefined,
  target: RuleElement | undefined,
  options: { allowSelfLoop?: boolean; catalog?: TypeCatalog } = {},
): ConnectionSpec | false {
  if (!source || !target) return false;

  const sourceType = bpmnTypeOf(source, options.catalog);
  const targetType = bpmnTypeOf(target, options.catalog);
  if (!sourceType || !targetType) return false;

  if (source === target && options.allowSelfLoop !== true) return false;

  if (isArtifact(sourceType) || isArtifact(targetType)) {
    return { type: CONNECTION.association };
  }

  if (isDataShape(sourceType) || isDataShape(targetType)) {
    if (isDataShape(sourceType) && isDataSink(targetType)) return { type: CONNECTION.dataInputAssociation };
    if (isDataSource(sourceType) && isDataShape(targetType)) return { type: CONNECTION.dataOutputAssociation };
    return false;
  }

  const sourcePool = participantOf(source);
  const targetPool = participantOf(target);
  if (sourcePool && targetPool && sourcePool !== targetPool) {
    return isMessageSource(sourceType) && isMessageTarget(targetType)
      ? { type: CONNECTION.messageFlow }
      : false;
  }

  if (!isBpmnSubtypeOf(sourceType, 'bpmn:FlowNode') || !isBpmnSubtypeOf(targetType, 'bpmn:FlowNode')) return false;
  // A process ends at an end event and starts at a start event; a boundary event
  // is reached by attachment, never by a flow.
  if (isBpmnSubtypeOf(sourceType, 'bpmn:EndEvent')) return false;
  if (isBpmnSubtypeOf(targetType, 'bpmn:StartEvent')) return false;
  if (isBpmnSubtypeOf(targetType, 'bpmn:BoundaryEvent')) return false;
  // Sequence flow never leaves its container (pool or subprocess).
  if (ruleContainerOf(source) !== ruleContainerOf(target)) return false;

  return { type: CONNECTION.sequenceFlow };
}

/** The connection type a schema-authorised pair gets when structure names none. */
export function defaultConnectionType(
  source: RuleElement | undefined,
  target: RuleElement | undefined,
): string {
  const sourcePool = participantOf(source);
  const targetPool = participantOf(target);
  return sourcePool && targetPool && sourcePool !== targetPool
    ? CONNECTION.messageFlow
    : CONNECTION.sequenceFlow;
}

/** Two connection types are interchangeable when one refines the other. */
function isCompatibleConnection(candidate: string, existing: string): boolean {
  return candidate === existing
    || isBpmnSubtypeOf(candidate, existing)
    || isBpmnSubtypeOf(existing, candidate);
}

// --- the engine -------------------------------------------------------------

/**
 * The canvas rule engine. Construct once per `Canvas` (or use the module-level
 * {@link defaultRules}); every method is a pure function of its arguments plus
 * the installed schema catalog.
 */
export class Rules {
  private readonly injectedCatalog: TypeCatalog | undefined;
  private readonly allowSelfLoop: boolean;
  private readonly minSizes: Readonly<Record<string, Size>> | undefined;

  constructor(options: RulesOptions = {}) {
    this.injectedCatalog = options.catalog;
    this.allowSelfLoop = options.allowSelfLoop === true;
    this.minSizes = options.minSizes;
  }

  /** The schema catalog, or `undefined` before `loadSchemas()` has ever run. */
  get catalog(): TypeCatalog | undefined {
    if (this.injectedCatalog) return this.injectedCatalog;
    return hasCatalog() ? getCatalog() : undefined;
  }

  /**
   * The schema layer's own verdict for a pair, straight from
   * `TypeCatalog.connectionRule` — `'defer'` when the source declares no
   * `meta.connectsTo` (or when no catalog is installed).
   */
  schemaVerdict(source: RuleElement | undefined, target: RuleElement | undefined): boolean | 'defer' {
    const catalog = this.catalog;
    if (!catalog) return 'defer';
    return catalog.connectionRule(typeRefOf(source), typeRefOf(target));
  }

  /**
   * `connection.create`. Returns the connection to mint, or `false`.
   *
   * A schema `false` vetoes; a schema `true` wins over structure (matching the
   * modeler, where `StudyflowRules` sits above `BpmnRules`) and falls back to
   * {@link defaultConnectionType} when structure named no type; `'defer'` hands
   * the decision to {@link structuralConnection}.
   */
  canConnect(source: RuleElement | undefined, target: RuleElement | undefined): ConnectionSpec | false {
    if (!source || !target) return false;

    const schema = this.schemaVerdict(source, target);
    if (schema === false) return false;

    const structural = structuralConnection(source, target, {
      allowSelfLoop: this.allowSelfLoop,
      catalog: this.catalog,
    });
    if (schema === true) {
      if (structural) return structural;
      // A schema authorises a PAIR of types; it cannot authorise an illegal document.
      // "A sequence flow must not cross a sub-process (or pool) boundary" is BPMN
      // structure, not type compatibility, so it survives a schema `true` — the
      // cross-pool case is already a MESSAGE flow, which is exactly the legal way out.
      const type = defaultConnectionType(source, target);
      if (type === CONNECTION.sequenceFlow && ruleContainerOf(source) !== ruleContainerOf(target)) {
        return false;
      }
      return { type };
    }
    return structural;
  }

  /**
   * `connection.reconnect`. The endpoint being kept is read off the connection,
   * so callers pass only the one they are dragging. The pair must not just be
   * connectable — it must stay connectable *as this kind of connection*
   * (dragging a sequence flow's end into another pool is a veto, not a silent
   * conversion to a message flow).
   */
  canReconnect(
    connection: RuleElement | undefined,
    source?: RuleElement,
    target?: RuleElement,
  ): ConnectionSpec | false {
    if (!connection) return false;
    const newSource = source ?? connection.source;
    const newTarget = target ?? connection.target;

    const verdict = this.canConnect(newSource, newTarget);
    if (!verdict) return false;

    const existing = bpmnTypeOf(connection, this.catalog);
    if (existing && !isCompatibleConnection(verdict.type, existing)) return false;
    return verdict;
  }

  /**
   * `elements.move` — a drop into `target` must be a legal CONTAINMENT for every
   * shape ({@link Rules.canCreate}) and must not strand a sequence flow.
   *
   * The second half is the BPMN rule {@link structuralConnection} already enforces
   * when a flow is DRAWN: a sequence flow lives in one `flowElements` container and
   * may not cross a sub-process or pool boundary. Dragging a connected shape across
   * that boundary would produce the same illegal document without ever asking, so it
   * is refused here — the way out of a sub-process is the sub-process's own flows, or
   * a boundary event on it.
   *
   * Only a drop that CHANGES a shape's container is judged. Moving one around inside
   * the container it already lives in is never a containment question, and judging it
   * would freeze every shape in a document that was imported with a crossing flow
   * already in it.
   *
   * A flow to something that is moving TOO is fine: both ends land in `target`.
   */
  canMove(shapes: readonly (RuleElement | undefined)[], target: RuleElement | undefined): boolean {
    const moving = new Set(shapes.filter((shape): shape is RuleElement => !!shape));
    if (![...moving].every((shape) => !!this.canCreate(shape, target))) return false;

    const to = dropContainerOf(target);
    for (const shape of moving) {
      if (ruleContainerOf(shape) === to) continue;
      for (const edge of [...(shape.incoming ?? []), ...(shape.outgoing ?? [])]) {
        const type = bpmnTypeOf(edge, this.catalog);
        if (!type || !isBpmnSubtypeOf(type, CONNECTION.sequenceFlow)) continue;
        const other = edge.source === shape ? edge.target : edge.source;
        if (!other || moving.has(other)) continue;
        if (ruleContainerOf(other) !== to) return false;
      }
    }
    return true;
  }

  /**
   * `shape.resize`. Which types resize at all, plus the width/height floor when
   * the caller supplies the bounds it is about to apply.
   */
  canResize(shape: RuleElement | undefined, newBounds?: Partial<Bounds>): boolean {
    if (!shape) return false;
    const type = bpmnTypeOf(shape, this.catalog);
    if (!isResizable(type)) return false;
    if (!newBounds) return true;

    const min = minSizeFor(type, this.minSizes);
    const { width, height } = newBounds;
    if (typeof width === 'number' && width < min.width) return false;
    if (typeof height === 'number' && height < min.height) return false;
    return true;
  }

  /**
   * The width/height floor this engine would judge `shape` against — the same
   * lookup {@link Rules.canResize} runs, exposed so a live resize gesture can
   * CLAMP to it instead of producing bounds the rules would then reject
   * (`interaction/drag.ts` `startResize`).
   */
  minSizeFor(shape: RuleElement | undefined): Size {
    return minSizeFor(bpmnTypeOf(shape, this.catalog), this.minSizes);
  }

  /**
   * `shape.create` — containment. `parent` may be a `SceneNode`, a `Plane`
   * (whose `businessObject` is the process/collaboration root) or `undefined`,
   * which is read as the default `bpmn:Process` root. A drop onto a `bpmn:Group`
   * is resolved to the group's own container ({@link containerFor}), and a drop
   * into a collapsed subprocess is refused.
   *
   * `options.root` is the plane the gesture is running on. It exists for one case:
   * a pool may be dropped on a `bpmn:Process` ROOT even though a process can never
   * contain one, because that drop promotes the root to a `bpmn:Collaboration`
   * ({@link Writeback.promoteRootToCollaboration}). Without the root to compare
   * against, "a process" and "the process this diagram IS" are indistinguishable
   * here, and a pool would become droppable inside a sub-process too.
   */
  canCreate(
    shape: RuleElement | undefined,
    parent?: RuleElement,
    options: { root?: RuleElement } = {},
  ): boolean | 'attach' {
    if (!shape) return false;

    const container = containerFor(parent);
    if (container && container === shape) return false;

    const containerType = container ? bpmnTypeOf(container, this.catalog) : 'bpmn:Process';
    if (container && isBpmnSubtypeOf(containerType, 'bpmn:SubProcess') && container.isExpanded === false) return false;

    const shapeType = bpmnTypeOf(shape, this.catalog);
    if (
      shapeType === 'bpmn:Participant'
      && containerType === 'bpmn:Process'
      && container !== undefined
      && container === options.root
    ) {
      return true;
    }

    return canContain(shapeType, containerType);
  }

  /** `shape.attach` — the boundary-event slice of {@link canCreate}. */
  canAttach(shape: RuleElement | undefined, parent?: RuleElement): 'attach' | false {
    return this.canCreate(shape, parent) === 'attach' ? 'attach' : false;
  }

  /**
   * `shape.append` — whether the context pad offers an append action on this
   * element (ports the gate in `contextPad/AppendMenuProvider.ts:70`). True for
   * anything a sequence flow may leave: a flow node that is not an end event.
   */
  canAppend(source: RuleElement | undefined): boolean {
    if (!source) return false;
    const type = bpmnTypeOf(source, this.catalog);
    if (!isBpmnSubtypeOf(type, 'bpmn:FlowNode')) return false;
    return !isBpmnSubtypeOf(type, 'bpmn:EndEvent');
  }

  /**
   * `connection.start` — whether the context pad offers "connect from here".
   *
   * Wider than {@link canAppend}, which asks only about SEQUENCE flow, and three
   * kinds of element can start an edge without being able to start one of those:
   *
   * - a **data shape** is no FlowNode and takes no successor, but a data INPUT
   *   association may start from it toward an activity;
   * - an **end event** is where sequence flow stops — and BPMN's Collaboration rules
   *   still let it THROW a message to another pool, which is a connection the pad has
   *   to be able to start or the flow cannot be drawn at all;
   * - an **artifact** (a text annotation, a group) is reached by, and can start, an
   *   association.
   *
   * The one thing this cannot promise is a legal TARGET — {@link Rules.canConnect}
   * judges that when the drag lands, exactly as it does for every other source.
   */
  canStartConnection(source: RuleElement | undefined): boolean {
    if (!source) return false;
    if (this.canAppend(source)) return true;
    const type = bpmnTypeOf(source, this.catalog);
    if (!type) return false;
    return isDataShape(type) || isArtifact(type) || isMessageSource(type) || isDataSource(type);
  }

  /**
   * `shape.append` narrowed to a KNOWN successor type — what the context pad asks
   * before it offers (and previews) one specific entry.
   *
   * An ARTIFACT is the exception {@link canAppend} cannot express: a text annotation
   * is reached by an association, not by a sequence flow, so bpmn-js offers "Add text
   * annotation" on an end event too (`ContextPadProvider` gates the artifact entry on
   * the flow-node test alone, and the end-event veto only on the successor entries).
   * Everything else falls back to {@link canAppend}.
   */
  canAppendType(source: RuleElement | undefined, targetType: string | undefined): boolean {
    if (!source) return false;
    if (targetType && isArtifact(targetType)) return !!bpmnTypeOf(source, this.catalog);
    return this.canAppend(source);
  }

  /**
   * `shape.replace` — whether `shape` may be retyped to `targetType` in place (the
   * context pad's wrench, ux-spec §4 entry 4).
   *
   * Replacement is a create in disguise: the new element has to be something the
   * SAME container would have accepted, so the containment rule does the work
   * ({@link canContain} against the parent the shape already lives in). Three things
   * it cannot express are vetoed here:
   *
   * - only a flow node or an artifact is replaceable at all. A pool, a lane or a
   *   plane root is structure, not a step, and retyping one is a different edit;
   * - a CONTAINER with contents is not offered, because there is no answer for what
   *   happens to what is inside it — bpmn-js migrates the children, the canvas has
   *   no such mutation, and silently dropping them would be the worst of the three;
   * - a boundary event is attached to a host, and an attachment is not carried
   *   across a retype.
   *
   * With no `targetType` the question is the weaker one the context pad asks before
   * it offers the wrench at all: may ANYTHING replace this element?
   */
  canReplace(shape: RuleElement | undefined, targetType?: string): boolean {
    if (!shape) return false;
    const replaceable = (candidate: string): boolean => (
      isBpmnSubtypeOf(candidate, 'bpmn:FlowNode') || isArtifact(candidate)
    );
    const type = bpmnTypeOf(shape, this.catalog);
    if (!type || !replaceable(type)) return false;
    if (isBpmnSubtypeOf(type, 'bpmn:BoundaryEvent')) return false;
    if ((shape.children?.length ?? 0) > 0) return false;
    // No successor named: the pad asking "is this element replaceable at all?"
    // before it offers the wrench, the way `canAppend` answers before `canAppendType`.
    if (!targetType) return true;
    if (!replaceable(targetType) || isBpmnSubtypeOf(targetType, 'bpmn:BoundaryEvent')) return false;
    const container = containerFor(shape.parent);
    const containerType = container ? bpmnTypeOf(container, this.catalog) : 'bpmn:Process';
    return canContain(targetType, containerType) === true;
  }

  /**
   * diagram-js-shaped entry point: `allowed(action, context)`. Unknown actions
   * answer `true` — the same "nobody vetoed it" default `Rules#allowed` has in
   * diagram-js, so a gesture the canvas does not gate is not silently blocked.
   */
  allowed(action: string, context: RuleContext = {}): RuleVerdict {
    switch (action) {
      case 'connection.create':
        return this.canConnect(asElement(context.source), asElement(context.target));

      case 'connection.start':
        return this.canStartConnection(asElement(context.source ?? context.element));

      case 'connection.reconnect':
      case 'connection.reconnectStart':
      case 'connection.reconnectEnd':
        return this.canReconnect(
          asElement(context.connection),
          asElement(context.source),
          asElement(context.target),
        );

      case 'shape.resize':
        return this.canResize(asElement(context.shape), asBounds(context.newBounds));

      case 'shape.create':
        return this.canCreate(
          asElement(context.shape),
          asElement(context.parent ?? context.target),
          { root: asElement(context.root) },
        );

      case 'shape.attach':
        return this.canAttach(asElement(context.shape), asElement(context.parent ?? context.target));

      case 'shape.append':
        return this.canAppendType(
          asElement(context.source ?? context.element ?? context.shape),
          // The context pad names the successor it is about to offer; without one
          // this is the plain "may anything follow?" question.
          typeof context.targetType === 'string' ? context.targetType : undefined,
        );

      case 'shape.replace':
        return this.canReplace(
          asElement(context.element ?? context.shape),
          typeof context.targetType === 'string' ? context.targetType : undefined,
        );

      case 'elements.move': {
        const target = asElement(context.target ?? context.parent);
        if (!target) return true;
        const shapes = Array.isArray(context.shapes) ? context.shapes : [];
        return this.canMove(shapes.map(asElement), target);
      }

      default:
        return true;
    }
  }
}

/** Shared instance for callers with no options to pass; reads the installed catalog. */
export const defaultRules = new Rules();

// --- context coercion -------------------------------------------------------

function asElement(value: unknown): RuleElement | undefined {
  return value && typeof value === 'object' ? (value as RuleElement) : undefined;
}

function asBounds(value: unknown): Partial<Bounds> | undefined {
  return value && typeof value === 'object' ? (value as Partial<Bounds>) : undefined;
}
