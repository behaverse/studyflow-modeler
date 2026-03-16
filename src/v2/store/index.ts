import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { NodeChange, EdgeChange, Connection } from '@xyflow/react';
import { BpmnDocument } from '../model/BpmnDocument';
import { toReactFlowNodes, toReactFlowEdges } from '../model/toReactFlow';
import { syncNodePosition } from '../model/fromReactFlow';
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
  isReady: false,
  diagramName: 'Untitled Diagram',
  _undoStack: [] as string[],
  _redoStack: [] as string[],

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
      _undoStack: [],
      _redoStack: [],
    });
  },

  async exportXml() {
    const { document: doc } = get();
    if (!doc) throw new Error('No document loaded.');
    return doc.toXML({ format: true });
  },

  refreshFromModel() {
    const { document: doc } = get();
    if (!doc) return;
    set({
      nodes: toReactFlowNodes(doc),
      edges: toReactFlowEdges(doc),
    });
  },

  /** Push current XML state onto undo stack before a mutation. */
  async _pushUndo() {
    const { document: doc, _undoStack } = get();
    if (!doc) return;
    try {
      const xml = await doc.toXML({ format: false });
      const newStack = [..._undoStack, xml];
      if (newStack.length > MAX_HISTORY) newStack.shift();
      set({ _undoStack: newStack, _redoStack: [] });
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
      });
    } catch { /* ignore */ }
  },

  addElement(bpmnType, position, studyflowType) {
    const { document: doc } = get();
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
    const width = isEvent ? 36 : isGateway ? 50 : 100;
    const height = isEvent ? 36 : isGateway ? 50 : 80;

    doc.addFlowElement(businessObject, {
      x: position.x,
      y: position.y,
      width,
      height,
    });

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
    const { document: doc, nodes } = get();

    const updatedNodes = applyNodeChanges(changes, nodes);

    if (doc) {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          syncNodePosition(doc, change.id, change.position);
        }
      }
    }

    const selectedIds = updatedNodes
      .filter((n) => n.selected)
      .map((n) => n.id);

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

    set({ edges: applyEdgeChanges(changes, edges) });
  },

  onConnect(connection: Connection) {
    const { document: doc } = get();
    if (!doc || !connection.source || !connection.target) return;

    get()._pushUndo();

    const process = doc.getProcess();
    if (!process?.flowElements) return;

    const sourceBO = process.flowElements.find(
      (el: any) => el.id === connection.source
    );
    const targetBO = process.flowElements.find(
      (el: any) => el.id === connection.target
    );
    if (!sourceBO || !targetBO) return;

    doc.addSequenceFlow(sourceBO, targetBO);
    get().refreshFromModel();
  },

  setSelection(nodeIds) {
    set({ selectedNodeIds: nodeIds });
  },

  setDiagramName(name) {
    set({ diagramName: name });
  },
}));
