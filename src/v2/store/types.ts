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

  /** Source node ID when the connect tool is active, otherwise null. */
  connectingFromId: string | null;

  /** Whether the token simulation is currently running. */
  simActive: boolean;

  /** Whether the modeler is initialized and ready. */
  isReady: boolean;

  /** Diagram name for display in the navbar. */
  diagramName: string;

  /** Undo history (XML snapshots). */
  _undoStack: string[];

  /** Redo history (XML snapshots). */
  _redoStack: string[];

  /** Incremented on every undo/redo so the inspector can remount with fresh values. */
  _modelVersion: number;

  /** ID of the node currently being edited inline (double-click label edit), or null. */
  editingNodeId: string | null;

  /** IDs of currently selected edges. */
  selectedEdgeIds: string[];

  /** Whether there are unsaved changes since the last import/save. */
  isDirty: boolean;

  /** Incremented each time simulation toggle is requested. */
  _simToggleCount: number;

  /** Incremented each time reset-zoom is requested. */
  _resetZoomCount: number;

  /**
   * ID of the subprocess currently being edited, or null for the root process.
   * Determines which flowElements are shown in the canvas.
   */
  scopeId: string | null;

  /** Breadcrumb trail of scopes entered. Each entry has id + display name. */
  scopeStack: { id: string; name: string }[];
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

  /** Enter connect-tool mode from a source node. */
  startConnecting(sourceId: string): void;

  /** Cancel the active connect-tool mode. */
  cancelConnecting(): void;

  /** Complete a connection to the given target node and exit connect-tool mode. */
  connectTo(targetId: string): void;

  /** Set diagram name. */
  setDiagramName(name: string): void;

  /** Sync simulation active state (called from ModelerCanvas). */
  setSimActive(active: boolean): void;

  /** Push current XML state onto undo stack. */
  _pushUndo(): Promise<void>;

  /** Undo the last mutation. */
  undo(): Promise<void>;

  /** Redo the last undone mutation. */
  redo(): Promise<void>;

  /** Mark the diagram as clean (saved). */
  markClean(): void;

  /**
   * Save the diagram to a file. Uses showSaveFilePicker (File System Access API)
   * when available so markClean is only called if the user confirms the save.
   * Falls back to a hidden anchor download for unsupported browsers.
   */
  saveFile(): Promise<void>;

  /** Set the node currently being edited inline. */
  setEditingNodeId(id: string | null): void;

  /** Request simulation toggle (consumed by ModelerCanvas). */
  requestToggleSim(): void;

  /** Request zoom reset (consumed by ModelerCanvas). */
  requestResetZoom(): void;

  /**
   * Change the BPMN type of an element in-place.
   * Preserves position, dimensions, name, and sequence flow connections.
   */
  morphElement(elementId: string, newBpmnType: string): void;

  /**
   * Connect two existing elements by ID within the current scope.
   * Used by ContextPad after addElement to wire up the new element.
   */
  connectElements(sourceId: string, targetId: string): void;

  /** Enter a subprocess scope — shows only its children in the canvas. */
  enterScope(subprocessId: string): void;

  /** Exit the current scope and return to the parent scope. */
  exitScope(): void;
}

export type ModelerStore = ModelerState & ModelerActions;
