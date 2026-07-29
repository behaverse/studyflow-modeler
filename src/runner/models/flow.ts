/** BPMN flow primitives; see `@/runner/models/studyflow` for the runtime wrapper. */
export type FlowNode = {
  id: string;
  type: string;
  extensionType?: string;
  businessObject: any;
  outgoing: string[];
  incoming: string[];
  /** Id of the container (process or sub-process) declaring this node. */
  scopeId: string;
};

export type SequenceFlow = {
  id: string;
  sourceId: string;
  targetId: string;
  conditionExpression?: string;
  businessObject: any;
};

/**
 * One declared variable — BPMN's own `bpmn:Property`, an item-aware element
 * that (unlike a data object) is never drawn, and that only processes,
 * activities, and events may contain (BPMN 2.0 §10.3.1).
 */
export type PropertyDecl = {
  id: string;
  /** Addressable name in condition expressions. Falls back to the id. */
  name: string;
  /** `structureRef` of the referenced `bpmn:ItemDefinition`, when typed. */
  itemType?: string;
  /** `bpmn:DataState#name`, when the declaration annotates one. */
  dataState?: string;
};

/**
 * A scope is the container whose instance bounds a set of declarations: the
 * process itself, or a sub-process. BPMN 2.0 §10.4.7 makes scopes
 * hierarchically nested and makes the scope decide what is visible inside it.
 */
export type Scope = {
  /** Owner element id — the process, or the sub-process node. */
  id: string;
  /** Enclosing scope; unset for the root (process) scope. */
  parentId?: string;
  /** Start event of this scope's own flow. Unset when a sub-process is empty. */
  startId?: string;
  properties: PropertyDecl[];
};
