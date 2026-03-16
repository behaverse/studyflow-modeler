import type { Node, Edge, NodeChange, EdgeChange, Connection } from '@xyflow/react';
import type { BpmnDocument } from '../model/BpmnDocument';

export interface ModelerState {
  /** The BpmnDocument instance (moddle bridge). */
  document: BpmnDocument | null;

  /** Loaded extension schemas. */
  schemas: Record<string, any>;

  /** React Flow nodes derived from the moddle model. */
  nodes: Node[];

  /** React Flow edges derived from the moddle model. */
  edges: Edge[];

  /** Currently selected node IDs. */
  selectedNodeIds: string[];

  /** Whether the modeler is initialized and ready. */
  isReady: boolean;

  /** Diagram name for display in the navbar. */
  diagramName: string;

  /** Undo history (XML snapshots). */
  _undoStack: string[];

  /** Redo history (XML snapshots). */
  _redoStack: string[];
}

export interface ModelerActions {
  /** Initialize the modeler: load schemas, parse initial XML, populate nodes/edges. */
  initialize(schemas: Record<string, any>, xml: string): Promise<void>;

  /** Import BPMN XML and rebuild nodes/edges. */
  importXml(xml: string): Promise<void>;

  /** Export current state as BPMN XML. */
  exportXml(): Promise<string>;

  /** Refresh nodes/edges from the current moddle definitions. */
  refreshFromModel(): void;

  /** Add a new BPMN element at the given position. */
  addElement(
    bpmnType: string,
    position: { x: number; y: number },
    studyflowType?: string,
  ): string;

  /** Remove elements by ID. */
  removeElements(ids: string[]): void;

  /** Update a property on a BPMN element. */
  updateProperty(elementId: string, propertyName: string, value: any): void;

  /** Handle React Flow node changes (drag, select, etc.). */
  onNodesChange(changes: NodeChange[]): void;

  /** Handle React Flow edge changes (select, remove, etc.). */
  onEdgesChange(changes: EdgeChange[]): void;

  /** Handle new connection between nodes. */
  onConnect(connection: Connection): void;

  /** Set selected node IDs. */
  setSelection(nodeIds: string[]): void;

  /** Set diagram name. */
  setDiagramName(name: string): void;

  /** Push current XML state onto undo stack. */
  _pushUndo(): Promise<void>;

  /** Undo the last mutation. */
  undo(): Promise<void>;

  /** Redo the last undone mutation. */
  redo(): Promise<void>;
}

export type ModelerStore = ModelerState & ModelerActions;
