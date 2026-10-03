/**
 * Rules: may this edit happen? Two layers, schema first: a `meta.connectsTo`
 * allow-list from the catalog (`true` wins, `false` vetoes, `'defer'` hands over),
 * then plain structural BPMN sense.
 */

import { extensionTypeOf } from '@core/model/index.ts';
import { isDataShape } from '@core/document/outline.ts';
import { bpmnFamilyOf, isBpmnSubtypeOf } from '@core/notation/bpmn.ts';
import { getCatalog, hasCatalog } from '@core/notation/index.ts';
import type { TypeCatalog } from '@core/notation/query.ts';
import type { Element } from '@core/model/index.ts';
import { idsIn } from '@canvas/study/elements.ts';

/** The structural minimum a rule needs; a detached palette shape satisfies it. */
export interface RuleElement {
  readonly type?: string;
  readonly element?: Element;
  readonly parent?: RuleElement;
  readonly children?: readonly unknown[];
  readonly source?: RuleElement;
  readonly target?: RuleElement;
  readonly incoming?: readonly RuleElement[];
  readonly outgoing?: readonly RuleElement[];
  readonly isExpanded?: boolean;
}

export interface ConnectionSpec {
  type: string;
}

export interface Size {
  width: number;
  height: number;
}

export const CONNECTION = {
  sequenceFlow: 'bpmn:SequenceFlow',
  messageFlow: 'bpmn:MessageFlow',
  association: 'bpmn:Association',
  dataInputAssociation: 'bpmn:DataInputAssociation',
  dataOutputAssociation: 'bpmn:DataOutputAssociation',
} as const;

function isArtifact(type: string): boolean {
  return isBpmnSubtypeOf(type, 'bpmn:Artifact');
}

function isFlowContainer(type: string): boolean {
  return type === 'bpmn:Process' || type === 'bpmn:Participant' || type === 'bpmn:Lane' || isBpmnSubtypeOf(type, 'bpmn:SubProcess');
}

function bpmnTypeOf(element: RuleElement | undefined, catalog?: TypeCatalog): string {
  const raw = element?.type ?? element?.element?.type;
  if (!raw) return '';
  if (raw.startsWith('bpmn:')) return raw;
  return catalog?.bpmnTypeOf(raw) ?? raw;
}

/** The extension type when there is one, else the BPMN type: what the schema rule is keyed by. */
function typeRefOf(element: RuleElement | undefined): string | undefined {
  if (!element) return undefined;
  return extensionTypeOf(element.element) ?? element.type ?? element.element?.type;
}

const MAX_DEPTH = 64;

function participantOf(element: RuleElement | undefined): RuleElement | undefined {
  let current = element;
  for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    if (bpmnTypeOf(current) === 'bpmn:Participant') return current;
    current = current.parent;
  }
  return undefined;
}

/** The nearest pool or sub-process (lanes and groups are visual nesting only). */
function ruleContainerOf(element: RuleElement | undefined): RuleElement | undefined {
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

/** What changes container with `shape` when it moves: itself, and for a lane the shapes in it and in the lanes inside it. */
function carriedBy(shape: RuleElement): RuleElement[] {
  if (bpmnTypeOf(shape) !== 'bpmn:Lane') return [shape];
  return [shape, ...(shape.children ?? []).flatMap((child) => carriedBy(child as RuleElement))];
}

/** Whether `shape` is a boundary event on an activity among `moving`: it rides on it, and is never dropped on its own. */
function ridesOn(shape: RuleElement, moving: ReadonlySet<RuleElement>): boolean {
  const host = idsIn(shape.element?.attachedToRef)[0];
  return !!host && [...moving].some((other) => other.element?.id === host);
}

function dropContainerOf(target: RuleElement | undefined): RuleElement | undefined {
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

function isResizable(type: string): boolean {
  return RESIZABLE_ANCESTORS.some((ancestor) => isBpmnSubtypeOf(type, ancestor));
}

const FALLBACK_MIN_SIZE: Size = { width: 20, height: 20 };

const MIN_SIZES: ReadonlyArray<readonly [string, Size]> = [
  ['bpmn:Participant', { width: 300, height: 60 }],
  ['bpmn:Lane', { width: 300, height: 60 }],
  ['bpmn:TextAnnotation', { width: 50, height: 30 }],
  ['bpmn:Group', { width: 60, height: 40 }],
  ['bpmn:ChoreographyActivity', { width: 100, height: 80 }],
  ['bpmn:Activity', { width: 100, height: 80 }],
];

function minSizeFor(type: string): Size {
  for (const [ancestor, size] of MIN_SIZES) if (isBpmnSubtypeOf(type, ancestor)) return size;
  return FALLBACK_MIN_SIZE;
}

/** May a `shapeType` live inside a `containerType`? `'attach'` is the boundary-event answer. */
function canContain(shapeType: string, containerType: string): boolean | 'attach' {
  if (!shapeType || !containerType) return false;
  if (isBpmnSubtypeOf(shapeType, 'bpmn:BoundaryEvent')) {
    return isBpmnSubtypeOf(containerType, 'bpmn:Activity') ? 'attach' : false;
  }
  if (containerType === 'bpmn:Collaboration') return shapeType === 'bpmn:Participant' || isArtifact(shapeType);
  if (isFlowContainer(containerType)) {
    if (shapeType === 'bpmn:Participant') return false;
    // BPMN puts lane sets on any FlowElementsContainer, so an expanded sub-process may be divided too.
    if (shapeType === 'bpmn:Lane') return containerType !== 'bpmn:Process';
    return isBpmnSubtypeOf(shapeType, 'bpmn:FlowNode') || isDataShape(shapeType) || isArtifact(shapeType);
  }
  return false;
}

/** A choreography task drawn in a pool (a cognitive task) exchanges messages with the other pool's steps. */
function isMessageSource(type: string): boolean {
  return type === 'bpmn:Participant' || isBpmnSubtypeOf(type, 'bpmn:Activity') || isBpmnSubtypeOf(type, 'bpmn:ThrowEvent')
    || isBpmnSubtypeOf(type, 'bpmn:ChoreographyTask');
}

function isMessageTarget(type: string): boolean {
  return type === 'bpmn:Participant' || isBpmnSubtypeOf(type, 'bpmn:Activity') || isBpmnSubtypeOf(type, 'bpmn:CatchEvent')
    || isBpmnSubtypeOf(type, 'bpmn:ChoreographyTask');
}

/** Owns `dataInputAssociations`. */
function isDataSink(type: string): boolean {
  return isBpmnSubtypeOf(type, 'bpmn:Activity') || isBpmnSubtypeOf(type, 'bpmn:ThrowEvent')
    || isBpmnSubtypeOf(type, 'bpmn:ChoreographyTask');
}

/** Owns `dataOutputAssociations`; a choreography task does too, through `studyflow:ChoreographyData`. */
function isDataSource(type: string): boolean {
  return isBpmnSubtypeOf(type, 'bpmn:Activity') || isBpmnSubtypeOf(type, 'bpmn:CatchEvent')
    || isBpmnSubtypeOf(type, 'bpmn:ChoreographyTask');
}

/** The structural verdict on a pair, and the connection type to mint. */
function structuralConnection(
  source: RuleElement | undefined,
  target: RuleElement | undefined,
  catalog?: TypeCatalog,
): ConnectionSpec | false {
  if (!source || !target) return false;
  const sourceType = bpmnTypeOf(source, catalog);
  const targetType = bpmnTypeOf(target, catalog);
  if (!sourceType || !targetType) return false;
  if (source === target) return false;
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

function defaultConnectionType(source: RuleElement | undefined, target: RuleElement | undefined): string {
  const sourcePool = participantOf(source);
  const targetPool = participantOf(target);
  return sourcePool && targetPool && sourcePool !== targetPool ? CONNECTION.messageFlow : CONNECTION.sequenceFlow;
}

function isCompatibleConnection(candidate: string, existing: string): boolean {
  return candidate === existing || isBpmnSubtypeOf(candidate, existing) || isBpmnSubtypeOf(existing, candidate);
}

export class Rules {
  private get catalog(): TypeCatalog | undefined {
    return hasCatalog() ? getCatalog() : undefined;
  }

  private schemaVerdict(source: RuleElement | undefined, target: RuleElement | undefined): boolean | 'defer' {
    const catalog = this.catalog;
    if (!catalog) return 'defer';
    return catalog.connectionRule(typeRefOf(source), typeRefOf(target));
  }

  canConnect(source: RuleElement | undefined, target: RuleElement | undefined): ConnectionSpec | false {
    if (!source || !target) return false;
    const schema = this.schemaVerdict(source, target);
    if (schema === false) return false;
    const structural = structuralConnection(source, target, this.catalog);
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

  /**
   * A drop must be a legal containment for every shape dropped (a boundary event whose activity moves too rides on
   * it), and leave each flow on what changes container (a moved shape, or one a moved lane carries) one the rules
   * would draw between its ends where they land: a sequence flow within one container, a message flow between two
   * pools. `target` takes what fits however it is drawn: a sub-process drawn shut is open to a view drilled into it,
   * and to a shape moved into it by id.
   */
  canMove(shapes: readonly (RuleElement | undefined)[], target: RuleElement | undefined): boolean {
    const moving = new Set(shapes.filter((shape): shape is RuleElement => !!shape));
    const open = target?.isExpanded === false ? { ...target, isExpanded: true } : target;
    if (![...moving].every((shape) => ridesOn(shape, moving) || !!this.canCreate(shape, open))) return false;
    const to = dropContainerOf(target);
    const carried = new Set([...moving].flatMap(carriedBy));
    // What moves lands in the target's container: a lane on the way there changes neither its pool nor its container.
    const landed = (end: RuleElement): RuleElement => (carried.has(end) ? { ...end, parent: to } : end);
    for (const shape of carried) {
      if (ruleContainerOf(shape) === to) continue;
      for (const edge of [...(shape.incoming ?? []), ...(shape.outgoing ?? [])]) {
        if (edge.source && edge.target && !this.canReconnect(edge, landed(edge.source), landed(edge.target))) return false;
      }
    }
    return true;
  }

  canResize(shape: RuleElement | undefined): boolean {
    return !!shape && isResizable(bpmnTypeOf(shape, this.catalog));
  }

  minSizeFor(shape: RuleElement | undefined): Size {
    return minSizeFor(bpmnTypeOf(shape, this.catalog));
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
    // A lane divides a process: a pool that depicts none has nothing to divide (a step dropped in gives it one).
    if (shapeType === 'bpmn:Lane' && containerType === 'bpmn:Participant' && !container?.element?.processRef) return false;
    return canContain(shapeType, containerType);
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

  /** May `shape` be retyped in place (to `targetType`, when given)? Within its family only (`bpmnFamilyOf`): a retype
   * across families rewires what an in-place swap cannot carry. */
  canReplace(shape: RuleElement | undefined, targetType?: string): boolean {
    if (!shape) return false;
    const replaceable = (candidate: string): boolean => isBpmnSubtypeOf(candidate, 'bpmn:FlowNode') || isArtifact(candidate);
    const type = bpmnTypeOf(shape, this.catalog);
    if (!type || !replaceable(type)) return false;
    if (isBpmnSubtypeOf(type, 'bpmn:BoundaryEvent')) return false;
    if ((shape.children?.length ?? 0) > 0) return false;
    if (!targetType) return true;
    if (!replaceable(targetType) || isBpmnSubtypeOf(targetType, 'bpmn:BoundaryEvent')) return false;
    if (bpmnFamilyOf(targetType) !== bpmnFamilyOf(type)) return false;
    const container = containerFor(shape.parent);
    const containerType = container ? bpmnTypeOf(container, this.catalog) : 'bpmn:Process';
    return canContain(targetType, containerType) === true;
  }
}
