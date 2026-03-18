import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { NodeChange, EdgeChange, Connection } from '@xyflow/react';
import { BpmnDocument } from '../model/BpmnDocument';
import { toReactFlowNodes, toReactFlowEdges } from '../model/toReactFlow';
import { syncNodePosition, syncNodeDimensions } from '../model/fromReactFlow';
import {
  createExtensionElement,
  getStudyflowDefaults,
  isExtendsType,
  setAppliedStudyflowType,
  setProperty,
  resolveProperty,
} from '../../shared/extensionElements';
import type { ModelerStore } from './types';

const MAX_HISTORY = 50;

export const useModelerStore = create<ModelerStore>((set, get) => ({
  // State
  document: null,
  schemas: {},
  nodes: [],
  edges: [],
  selectedNodeIds: [],
  selectedEdgeIds: [],
  connectingFromId: null,
  simActive: false,
  isReady: false,
  diagramName: 'Untitled Diagram',
  _undoStack: [] as string[],
  _redoStack: [] as string[],
  _modelVersion: 0,
  isDirty: false,
  editingNodeId: null,
  _simToggleCount: 0,
  _resetZoomCount: 0,
  scopeId: null,
  scopeStack: [],

  // Actions
  async initialize(schemas, xml) {
    const doc = new BpmnDocument(schemas);
    await doc.fromXML(xml);

    set({
      document: doc,
      schemas,
      nodes: toReactFlowNodes(doc),
      edges: toReactFlowEdges(doc),
      isReady: true,
      _undoStack: [],
      _redoStack: [],
    });
  },

  async importXml(xml) {
    const { document: doc } = get();
    if (!doc) return;

    await doc.fromXML(xml);
    set({
      nodes: toReactFlowNodes(doc),
      edges: toReactFlowEdges(doc),
      selectedNodeIds: [],
      selectedEdgeIds: [],
      _undoStack: [],
      _redoStack: [],
      isDirty: false,
    });
  },

  async exportXml() {
    const { document: doc } = get();
    if (!doc) throw new Error('No document loaded.');
    return doc.toXML({ format: true });
  },

  refreshFromModel() {
    const { document: doc, selectedNodeIds, scopeId } = get();
    if (!doc) return;
    const scope = scopeId ? doc.getScope(scopeId) : undefined;
    const selectedSet = new Set(selectedNodeIds);
    const nodes = toReactFlowNodes(doc, scope).map((n) =>
      selectedSet.has(n.id) ? { ...n, selected: true } : n,
    );
    set({ nodes, edges: toReactFlowEdges(doc, scope) });
  },

  /** Push current XML state onto undo stack before a mutation. */
  async _pushUndo() {
    const { document: doc, _undoStack } = get();
    if (!doc) return;
    try {
      const xml = await doc.toXML({ format: false });
      const newStack = [..._undoStack, xml];
      if (newStack.length > MAX_HISTORY) newStack.shift();
      set({ _undoStack: newStack, _redoStack: [], isDirty: true });
    } catch { /* ignore serialization failures */ }
  },

  async undo() {
    const { document: doc, _undoStack, _redoStack } = get();
    if (!doc || _undoStack.length === 0) return;

    // Save current state to redo stack
    try {
      const currentXml = await doc.toXML({ format: false });
      const newRedoStack = [..._redoStack, currentXml];

      const previousXml = _undoStack[_undoStack.length - 1];
      const newUndoStack = _undoStack.slice(0, -1);

      await doc.fromXML(previousXml);
      set({
        nodes: toReactFlowNodes(doc),
        edges: toReactFlowEdges(doc),
        _undoStack: newUndoStack,
        _redoStack: newRedoStack,
        _modelVersion: get()._modelVersion + 1,
        isDirty: true,
        scopeId: null,
        scopeStack: [],
      });
    } catch { /* ignore */ }
  },

  async redo() {
    const { document: doc, _undoStack, _redoStack } = get();
    if (!doc || _redoStack.length === 0) return;

    try {
      const currentXml = await doc.toXML({ format: false });
      const newUndoStack = [..._undoStack, currentXml];

      const nextXml = _redoStack[_redoStack.length - 1];
      const newRedoStack = _redoStack.slice(0, -1);

      await doc.fromXML(nextXml);
      set({
        nodes: toReactFlowNodes(doc),
        edges: toReactFlowEdges(doc),
        _undoStack: newUndoStack,
        _redoStack: newRedoStack,
        _modelVersion: get()._modelVersion + 1,
        isDirty: true,
        scopeId: null,
        scopeStack: [],
      });
    } catch { /* ignore */ }
  },

  addElement(bpmnType, position, studyflowType) {
    const { document: doc, scopeId } = get();
    if (!doc) throw new Error('No document loaded.');

    // Push undo before mutation
    get()._pushUndo();

    const moddle = doc.getModdle();

    const prefix = studyflowType
      ? studyflowType.split(':')[1]
      : bpmnType.includes(':')
        ? bpmnType.split(':')[1]
        : bpmnType;
    const id = doc.nextId(prefix);

    let extendedDefaults: Record<string, any> = {};
    if (studyflowType && isExtendsType(studyflowType, moddle)) {
      extendedDefaults = getStudyflowDefaults(studyflowType, moddle);
    }

    const businessObject = doc.createElement(bpmnType, {
      ...extendedDefaults,
      id,
    });

    if (studyflowType && isExtendsType(studyflowType, moddle)) {
      setAppliedStudyflowType(businessObject, studyflowType);
    }

    if (studyflowType && !isExtendsType(studyflowType, moddle)) {
      const defaults = getStudyflowDefaults(studyflowType, moddle);
      createExtensionElement(businessObject, studyflowType, moddle, defaults);
    }

    const isEvent = bpmnType.includes('Event');
    const isGateway = bpmnType.includes('Gateway');
    const isDataStore = bpmnType === 'bpmn:DataStoreReference' || bpmnType === 'bpmn:DataObjectReference';
    const width = isEvent ? 36 : isGateway ? 50 : isDataStore ? 50 : 100;
    const height = isEvent ? 36 : isGateway ? 50 : isDataStore ? 50 : 80;

    doc.addFlowElementToScope(businessObject, {
      x: position.x,
      y: position.y,
      width,
      height,
    }, scopeId);

    get().refreshFromModel();
    return id;
  },

  removeElements(ids) {
    const { document: doc } = get();
    if (!doc) return;

    get()._pushUndo();

    for (const id of ids) {
      doc.removeFlowElement(id);
    }

    get().refreshFromModel();
  },

  updateProperty(elementId, propertyName, value) {
    const { document: doc, nodes } = get();
    if (!doc) return;

    const node = nodes.find((n) => n.id === elementId);
    const bo = node?.data?.businessObject;
    if (!bo) {
      // Try process root
      const process = doc.getProcess();
      if (process?.id === elementId || !node) {
        const target = process?.id === elementId ? process : bo;
        if (target) {
          const resolution = resolveProperty(target, propertyName);
          if (resolution.target && resolution.propertyName) {
            setProperty(target, propertyName, value);
          }
        }
        get().refreshFromModel();
        return;
      }
      return;
    }

    // Use the extensionElements resolution system
    setProperty(bo, propertyName, value);
    get().refreshFromModel();
  },

  onNodesChange(changes: NodeChange[]) {
    // Route keyboard-delete (remove changes) through removeElements so undo is pushed
    const removes = changes.filter((c) => c.type === 'remove') as { type: 'remove'; id: string }[];
    const others = changes.filter((c) => c.type !== 'remove');

    if (removes.length > 0) {
      get().removeElements(removes.map((c) => c.id));
      if (others.length === 0) return;
    }

    const { document: doc, nodes } = get();
    const updatedNodes = applyNodeChanges(others, nodes);

    if (doc) {
      for (const change of others) {
        if (change.type === 'position' && change.position) {
          syncNodePosition(doc, change.id, change.position);
        }
        if (change.type === 'dimensions' && change.dimensions) {
          syncNodeDimensions(doc, change.id, change.dimensions);
        }
      }
    }

    const selectedIds = updatedNodes.filter((n) => n.selected).map((n) => n.id);
    set({ nodes: updatedNodes, selectedNodeIds: selectedIds });
  },

  onEdgesChange(changes: EdgeChange[]) {
    const { document: doc, edges } = get();

    // Handle edge removals in the moddle model
    if (doc) {
      for (const change of changes) {
        if (change.type === 'remove') {
          get()._pushUndo();
          doc.removeFlowElement(change.id);
        }
      }
    }

    const updatedEdges = applyEdgeChanges(changes, edges);
    const selectedEdgeIds = updatedEdges.filter((e) => e.selected).map((e) => e.id);
    set({ edges: updatedEdges, selectedEdgeIds });
  },

  onConnect(connection: Connection) {
    const { document: doc, scopeId } = get();
    if (!doc || !connection.source || !connection.target) return;

    get()._pushUndo();

    const scope = doc.getScope(scopeId);
    if (!scope?.flowElements) return;

    const sourceBO = scope.flowElements.find(
      (el: any) => el.id === connection.source
    );
    const targetBO = scope.flowElements.find(
      (el: any) => el.id === connection.target
    );
    if (!sourceBO || !targetBO) return;

    doc.addSequenceFlowInScope(sourceBO, targetBO, scopeId);
    get().refreshFromModel();
  },

  setSelection(nodeIds) {
    set({ selectedNodeIds: nodeIds });
  },

  setDiagramName(name) {
    set({ diagramName: name });
  },

  setSimActive(active) {
    set({ simActive: active });
  },

  startConnecting(sourceId) {
    set({ connectingFromId: sourceId });
  },

  cancelConnecting() {
    set({ connectingFromId: null });
  },

  markClean() {
    set({ isDirty: false });
  },

  async saveFile() {
    const { document: doc, diagramName } = get();
    if (!doc) return;
    const xml = await doc.toXML({ format: true });
    const filename = `${diagramName}.bpmn`;

    if ('showSaveFilePicker' in window) {
      try {
        const fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'BPMN files', accept: { 'text/xml': ['.bpmn', '.xml'] } }],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(xml);
        await writable.close();
        set({ isDirty: false });
      } catch (err: any) {
        if (err.name !== 'AbortError') throw err;
        // User cancelled — do not mark clean
      }
    } else {
      // Fallback: anchor download (no cancellation detection in older browsers)
      const blob = new Blob([xml], { type: 'text/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      set({ isDirty: false });
    }
  },

  setEditingNodeId(id) {
    set({ editingNodeId: id });
  },

  morphElement(elementId, newBpmnType) {
    const { document: doc, scopeId } = get();
    if (!doc) return;

    get()._pushUndo();

    const scope = doc.getScope(scopeId);
    if (!scope?.flowElements) return;

    const oldBO = scope.flowElements.find((el: any) => el.id === elementId);
    if (!oldBO) return;

    // Collect incoming/outgoing flows
    const incoming: any[] = (oldBO.incoming ?? []).slice();
    const outgoing: any[] = (oldBO.outgoing ?? []).slice();
    const name = oldBO.name;

    // Get current DI bounds
    const di = doc.findShape(elementId);
    const bounds = di?.bounds ? { ...di.bounds } : null;

    // Remove old element (this also removes its DI)
    doc.removeFlowElement(elementId);

    // Create new element of new type with same ID and name
    const moddle = doc.getModdle();
    const newBO = moddle.create(newBpmnType, { id: elementId, name });

    // Re-add at same position (scope-aware)
    doc.addFlowElementToScope(newBO, bounds
      ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
      : { x: 100, y: 100, width: 100, height: 80 },
      scopeId,
    );

    // Restore flows: update their source/target references
    for (const flow of outgoing) {
      flow.sourceRef = newBO;
      if (!newBO.outgoing) newBO.outgoing = [];
      newBO.outgoing.push(flow);
    }
    for (const flow of incoming) {
      flow.targetRef = newBO;
      if (!newBO.incoming) newBO.incoming = [];
      newBO.incoming.push(flow);
    }

    get().refreshFromModel();
  },

  connectElements(sourceId, targetId) {
    const { document: doc, scopeId } = get();
    if (!doc) return;
    const scope = doc.getScope(scopeId);
    const sourceBO = scope?.flowElements?.find((el: any) => el.id === sourceId);
    const targetBO = scope?.flowElements?.find((el: any) => el.id === targetId);
    if (sourceBO && targetBO) {
      doc.addSequenceFlowInScope(sourceBO, targetBO, scopeId);
      get().refreshFromModel();
    }
  },

  enterScope(subprocessId) {
    const { document: doc, scopeStack } = get();
    if (!doc) return;
    const sp = doc.findFlowElement(subprocessId);
    if (!sp) return;
    const newStack = [...scopeStack, { id: subprocessId, name: sp.name || 'Sub-Process' }];
    set({
      scopeId: subprocessId,
      scopeStack: newStack,
      nodes: toReactFlowNodes(doc, sp),
      edges: toReactFlowEdges(doc, sp),
      selectedNodeIds: [],
      selectedEdgeIds: [],
      connectingFromId: null,
    });
  },

  exitScope() {
    const { document: doc, scopeStack } = get();
    if (!doc || scopeStack.length === 0) return;
    const newStack = scopeStack.slice(0, -1);
    const newScopeId = newStack.length > 0 ? newStack[newStack.length - 1].id : null;
    const scope = newScopeId ? doc.findFlowElement(newScopeId) : undefined;
    set({
      scopeId: newScopeId,
      scopeStack: newStack,
      nodes: toReactFlowNodes(doc, scope),
      edges: toReactFlowEdges(doc, scope),
      selectedNodeIds: [],
      selectedEdgeIds: [],
      connectingFromId: null,
    });
  },

  requestToggleSim() {
    set((s) => ({ _simToggleCount: s._simToggleCount + 1 }));
  },

  requestResetZoom() {
    set((s) => ({ _resetZoomCount: s._resetZoomCount + 1 }));
  },

  connectTo(targetId) {
    const { document: doc, connectingFromId, scopeId } = get();
    if (!doc || !connectingFromId || connectingFromId === targetId) {
      set({ connectingFromId: null });
      return;
    }
    const scope = doc.getScope(scopeId);
    const sourceBO = scope?.flowElements?.find((el: any) => el.id === connectingFromId);
    const targetBO = scope?.flowElements?.find((el: any) => el.id === targetId);
    if (sourceBO && targetBO) {
      get()._pushUndo();
      doc.addSequenceFlowInScope(sourceBO, targetBO, scopeId);
      get().refreshFromModel();
    }
    set({ connectingFromId: null });
  },
}));
