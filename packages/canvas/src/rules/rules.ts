/**
 * Rules: may this edit happen? Two layers, schema first: a `meta.connectsTo`
 * allow-list from the catalog (`true` wins, `false` vetoes, `'defer'` hands over),
 * then plain structural BPMN sense.
 */

import { getExtensionType } from '@core/element/index.ts';
import { isBpmnSubtypeOf } from '@core/notation/bpmn.ts';
import { getCatalog, hasCatalog } from '@core/notation/index.ts';
import type { TypeCatalog } from '@core/notation/query.ts';
import type { Bounds, ModdleObject } from '@canvas/model/scene.ts';

/** The structural minimum a rule needs; a detached palette shape satisfies it. */
export interface RuleElement {
  readonly type?: string;
  readonly businessObject?: ModdleObject;
  readonly parent?: RuleElement;
  readonly children?: readonly unknown[];
  readonly source?: RuleElement;
  readonly target?: RuleElement;
  readonly incoming?: readonly RuleElement[];
  readonly outgoing?: readonly RuleElement[];
  readonly isExpanded?: boolean;
}

export type RuleContext = Record<string, unknown>;

export interface ConnectionSpec {
  type: string;
}

export type RuleVerdict = boolean | 'attach' | ConnectionSpec;

export interface Size {
  width: number;
  height: number;
}

export interface RulesOptions {
  catalog?: TypeCatalog;
  allowSelfLoop?: boolean;
  minSizes?: Readonly<Record<string, Size>>;
}

export const CONNECTION = {
  sequenceFlow: 'bpmn:SequenceFlow',
  messageFlow: 'bpmn:MessageFlow',
  association: 'bpmn:Association',
  dataInputAssociation: 'bpmn:DataInputAssociation',
  dataOutputAssociation: 'bpmn:DataOutputAssociation',
} as const;

export const DATA_TYPES: ReadonlySet<string> = new Set([
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:DataObject',
  'bpmn:DataStore',
]);

export const DATA_STORE_TYPES: ReadonlySet<string> = new Set(['bpmn:DataStoreReference', 'bpmn:DataStore']);

export function isDataShape(type: string): boolean {
  return DATA_TYPES.has(type);
}

export function isDataStore(type: string): boolean {
  return DATA_STORE_TYPES.has(type);
}

function isArtifact(type: string): boolean {
  return isBpmnSubtypeOf(type, 'bpmn:Artifact');
}

function isFlowContainer(type: string): boolean {
  return type === 'bpmn:Process' || type === 'bpmn:Participant' || type === 'bpmn:Lane' || isBpmnSubtypeOf(type, 'bpmn:SubProcess');
}

export function bpmnTypeOf(element: RuleElement | undefined, catalog?: TypeCatalog): string {
  const raw = element?.type ?? (element?.businessObject?.$type as string | undefined);
  if (!raw) return '';
  if (raw.startsWith('bpmn:')) return raw;
  return catalog?.bpmnTypeOf(raw) ?? raw;
}

/** The extension type when there is one, else the BPMN type: what the schema rule is keyed by. */
export function typeRefOf(element: RuleElement | undefined): string | undefined {
  if (!element) return undefined;
  const bo = element.businessObject;
  return (bo ? getExtensionType(bo) : undefined) ?? element.type ?? (bo?.$type as string | undefined);
}

const MAX_DEPTH = 64;

export function participantOf(element: RuleElement | undefined): RuleElement | undefined {
  let current = element;
  for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    if (bpmnTypeOf(current) === 'bpmn:Participant') return current;
    current = current.parent;
  }
  return undefined;
}

/** The nearest pool or sub-process (lanes and groups are visual nesting only). */
export function ruleContainerOf(element: RuleElement | undefined): RuleElement | undefined {
  let current = element?.parent;
  for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    const type = bpmnTypeOf(current);
    if (type !== 'bpmn:Lane' && type !== 'bpmn:Group') return current;
    current = current.parent;
  }
  return undefined;
}

/** The element that owns a shape dropped on `parent`: a group hands over to its container. */
export function containerFor(parent: RuleElement | undefined): RuleElement | undefined {
  let current = parent;
  for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    if (bpmnTypeOf(current) !== 'bpmn:Group') return current;
    current = current.parent;
  }
  return undefined;
}

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

const RESIZABLE_ANCESTORS: readonly string[] = [
  'bpmn:Activity', 'bpmn:ChoreographyActivity', 'bpmn:Participant', 'bpmn:Lane', 'bpmn:Group', 'bpmn:TextAnnotation',
];

export function isResizable(type: string): boolean {
  return RESIZABLE_ANCESTORS.some((ancestor) => isBpmnSubtypeOf(type, ancestor));
}

export const FALLBACK_MIN_SIZE: Size = { width: 20, height: 20 };

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
  for (const [ancestor, size] of MIN_SIZES) if (isBpmnSubtypeOf(type, ancestor)) return size;
  return FALLBACK_MIN_SIZE;
}

/** May a `shapeType` live inside a `containerType`? `'attach'` is the boundary-event answer. */
export function canContain(shapeType: string, containerType: string): boolean | 'attach' {
  if (!shapeType || !containerType) return false;
  if (isBpmnSubtypeOf(shapeType, 'bpmn:BoundaryEvent')) {
    return isBpmnSubtypeOf(containerType, 'bpmn:Activity') ? 'attach' : false;
  }
  if (containerType === 'bpmn:Collaboration') return shapeType === 'bpmn:Participant' || isArtifact(shapeType);
  if (containerType === 'bpmn:Choreography') {
    return isBpmnSubtypeOf(shapeType, 'bpmn:ChoreographyActivity')
      || isBpmnSubtypeOf(shapeType, 'bpmn:Event')
      || isBpmnSubtypeOf(shapeType, 'bpmn:Gateway')
      || isArtifact(shapeType);
  }
  if (isFlowContainer(containerType)) {
    if (shapeType === 'bpmn:Participant') return false;
    if (shapeType === 'bpmn:Lane') return containerType === 'bpmn:Participant' || containerType === 'bpmn:Lane';
    return isBpmnSubtypeOf(shapeType, 'bpmn:FlowNode') || isDataShape(shapeType) || isArtifact(shapeType);
  }
  return false;
}

function isMessageSource(type: string): boolean {
  return type === 'bpmn:Participant' || isBpmnSubtypeOf(type, 'bpmn:Activity') || isBpmnSubtypeOf(type, 'bpmn:ThrowEvent');
}

function isMessageTarget(type: string): boolean {
  return type === 'bpmn:Participant' || isBpmnSubtypeOf(type, 'bpmn:Activity') || isBpmnSubtypeOf(type, 'bpmn:CatchEvent');
}

/** Owns `dataInputAssociations`. */
function isDataSink(type: string): boolean {
  return isBpmnSubtypeOf(type, 'bpmn:Activity') || isBpmnSubtypeOf(type, 'bpmn:ThrowEvent');
}

/** Owns `dataOutputAssociations`. */
function isDataSource(type: string): boolean {
  return isBpmnSubtypeOf(type, 'bpmn:Activity') || isBpmnSubtypeOf(type, 'bpmn:CatchEvent');
}

/** The structural verdict on a pair, and the connection type to mint. */
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
  if (isArtifact(sourceType) || isArtifact(targetType)) return { type: CONNECTION.association };
  if (isDataShape(sourceType) || isDataShape(targetType)) {
    if (isDataShape(sourceType) && isDataSink(targetType)) return { type: CONNECTION.dataInputAssociation };
    if (isDataSource(sourceType) && isDataShape(targetType)) return { type: CONNECTION.dataOutputAssociation };
    return false;
  }
  const sourcePool = participantOf(source);
  const targetPool = participantOf(target);
  if (sourcePool && targetPool && sourcePool !== targetPool) {
    return isMessageSource(sourceType) && isMessageTarget(targetType) ? { type: CONNECTION.messageFlow } : false;
  }
  if (!isBpmnSubtypeOf(sourceType, 'bpmn:FlowNode') || !isBpmnSubtypeOf(targetType, 'bpmn:FlowNode')) return false;
  if (isBpmnSubtypeOf(sourceType, 'bpmn:EndEvent')) return false;
  if (isBpmnSubtypeOf(targetType, 'bpmn:StartEvent')) return false;
  if (isBpmnSubtypeOf(targetType, 'bpmn:BoundaryEvent')) return false;
  if (ruleContainerOf(source) !== ruleContainerOf(target)) return false;
  return { type: CONNECTION.sequenceFlow };
}

export function defaultConnectionType(source: RuleElement | undefined, target: RuleElement | undefined): string {
  const sourcePool = participantOf(source);
  const targetPool = participantOf(target);
  return sourcePool && targetPool && sourcePool !== targetPool ? CONNECTION.messageFlow : CONNECTION.sequenceFlow;
}

function isCompatibleConnection(candidate: string, existing: string): boolean {
  return candidate === existing || isBpmnSubtypeOf(candidate, existing) || isBpmnSubtypeOf(existing, candidate);
}

export class Rules {
  private readonly injectedCatalog: TypeCatalog | undefined;
  private readonly allowSelfLoop: boolean;
  private readonly minSizes: Readonly<Record<string, Size>> | undefined;

  constructor(options: RulesOptions = {}) {
    this.injectedCatalog = options.catalog;
    this.allowSelfLoop = options.allowSelfLoop === true;
    this.minSizes = options.minSizes;
  }

  get catalog(): TypeCatalog | undefined {
    if (this.injectedCatalog) return this.injectedCatalog;
    return hasCatalog() ? getCatalog() : undefined;
  }

  schemaVerdict(source: RuleElement | undefined, target: RuleElement | undefined): boolean | 'defer' {
    const catalog = this.catalog;
    if (!catalog) return 'defer';
    return catalog.connectionRule(typeRefOf(source), typeRefOf(target));
  }

  canConnect(source: RuleElement | undefined, target: RuleElement | undefined): ConnectionSpec | false {
    if (!source || !target) return false;
    const schema = this.schemaVerdict(source, target);
    if (schema === false) return false;
    const structural = structuralConnection(source, target, { allowSelfLoop: this.allowSelfLoop, catalog: this.catalog });
    if (schema === true) {
      if (structural) return structural;
      // A schema authorises a pair of types, not a flow across a container boundary.
      const type = defaultConnectionType(source, target);
      if (type === CONNECTION.sequenceFlow && ruleContainerOf(source) !== ruleContainerOf(target)) return false;
      return { type };
    }
    return structural;
  }

  /** The pair must stay connectable as the connection's own type. */
  canReconnect(connection: RuleElement | undefined, source?: RuleElement, target?: RuleElement): ConnectionSpec | false {
    if (!connection) return false;
    const verdict = this.canConnect(source ?? connection.source, target ?? connection.target);
    if (!verdict) return false;
    const existing = bpmnTypeOf(connection, this.catalog);
    if (existing && !isCompatibleConnection(verdict.type, existing)) return false;
    return verdict;
  }

  /** A drop must be a legal containment for every shape and must not strand a sequence flow. */
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

  canResize(shape: RuleElement | undefined, newBounds?: Partial<Bounds>): boolean {
    if (!shape) return false;
    const type = bpmnTypeOf(shape, this.catalog);
    if (!isResizable(type)) return false;
    if (!newBounds) return true;
    const min = minSizeFor(type, this.minSizes);
    if (typeof newBounds.width === 'number' && newBounds.width < min.width) return false;
    if (typeof newBounds.height === 'number' && newBounds.height < min.height) return false;
    return true;
  }

  minSizeFor(shape: RuleElement | undefined): Size {
    return minSizeFor(bpmnTypeOf(shape, this.catalog), this.minSizes);
  }

  /**
   * Containment. `parent` is a node, the root element or `undefined` (read as a
   * process). `options.root` lets a pool be dropped on the diagram's own process
   * root, which promotes it to a collaboration.
   */
  canCreate(shape: RuleElement | undefined, parent?: RuleElement, options: { root?: RuleElement } = {}): boolean | 'attach' {
    if (!shape) return false;
    const container = containerFor(parent);
    if (container && container === shape) return false;
    const containerType = container ? bpmnTypeOf(container, this.catalog) : 'bpmn:Process';
    if (container && isBpmnSubtypeOf(containerType, 'bpmn:SubProcess') && container.isExpanded === false) return false;
    const shapeType = bpmnTypeOf(shape, this.catalog);
    if (shapeType === 'bpmn:Participant' && containerType === 'bpmn:Process' && container !== undefined && container === options.root) {
      return true;
    }
    return canContain(shapeType, containerType);
  }

  canAttach(shape: RuleElement | undefined, parent?: RuleElement): 'attach' | false {
    return this.canCreate(shape, parent) === 'attach' ? 'attach' : false;
  }

  /** May a sequence-flow successor follow this element? */
  canAppend(source: RuleElement | undefined): boolean {
    if (!source) return false;
    const type = bpmnTypeOf(source, this.catalog);
    return isBpmnSubtypeOf(type, 'bpmn:FlowNode') && !isBpmnSubtypeOf(type, 'bpmn:EndEvent');
  }

  /** May any edge start here? Wider than `canAppend`: data shapes, artifacts, message sources. */
  canStartConnection(source: RuleElement | undefined): boolean {
    if (!source) return false;
    if (this.canAppend(source)) return true;
    const type = bpmnTypeOf(source, this.catalog);
    if (!type) return false;
    return isDataShape(type) || isArtifact(type) || isMessageSource(type) || isDataSource(type);
  }

  /** `canAppend` narrowed to a successor type; an artifact is reached by association from anything. */
  canAppendType(source: RuleElement | undefined, targetType: string | undefined): boolean {
    if (!source) return false;
    if (targetType && isArtifact(targetType)) return !!bpmnTypeOf(source, this.catalog);
    return this.canAppend(source);
  }

  /** May `shape` be retyped in place (to `targetType`, when given)? */
  canReplace(shape: RuleElement | undefined, targetType?: string): boolean {
    if (!shape) return false;
    const replaceable = (candidate: string): boolean => isBpmnSubtypeOf(candidate, 'bpmn:FlowNode') || isArtifact(candidate);
    const type = bpmnTypeOf(shape, this.catalog);
    if (!type || !replaceable(type)) return false;
    if (isBpmnSubtypeOf(type, 'bpmn:BoundaryEvent')) return false;
    if ((shape.children?.length ?? 0) > 0) return false;
    if (!targetType) return true;
    if (!replaceable(targetType) || isBpmnSubtypeOf(targetType, 'bpmn:BoundaryEvent')) return false;
    const container = containerFor(shape.parent);
    const containerType = container ? bpmnTypeOf(container, this.catalog) : 'bpmn:Process';
    return canContain(targetType, containerType) === true;
  }

  /** `allowed(action, context)` string dispatch; unknown actions answer `true`. */
  allowed(action: string, context: RuleContext = {}): RuleVerdict {
    switch (action) {
      case 'connection.create':
        return this.canConnect(asElement(context.source), asElement(context.target));
      case 'connection.start':
        return this.canStartConnection(asElement(context.source ?? context.element));
      case 'connection.reconnect':
      case 'connection.reconnectStart':
      case 'connection.reconnectEnd':
        return this.canReconnect(asElement(context.connection), asElement(context.source), asElement(context.target));
      case 'shape.resize':
        return this.canResize(asElement(context.shape), asBounds(context.newBounds));
      case 'shape.create':
        return this.canCreate(asElement(context.shape), asElement(context.parent ?? context.target), { root: asElement(context.root) });
      case 'shape.attach':
        return this.canAttach(asElement(context.shape), asElement(context.parent ?? context.target));
      case 'shape.append':
        return this.canAppendType(
          asElement(context.source ?? context.element ?? context.shape),
          typeof context.targetType === 'string' ? context.targetType : undefined,
        );
      case 'shape.replace':
        return this.canReplace(asElement(context.element ?? context.shape), typeof context.targetType === 'string' ? context.targetType : undefined);
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

export const defaultRules = new Rules();

function asElement(value: unknown): RuleElement | undefined {
  return value && typeof value === 'object' ? (value as RuleElement) : undefined;
}

function asBounds(value: unknown): Partial<Bounds> | undefined {
  return value && typeof value === 'object' ? (value as Partial<Bounds>) : undefined;
}
