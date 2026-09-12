import { defaultSizeFor, isExpandable, type Bounds, type Canvas, type SceneNode, type ShapeDescriptor } from '@canvas/index.ts';
import { studyflowToDefinitions } from '@core/document';
import type { Template } from '@core/notation';
import type { EditorModel, ModelElement } from '@modeler/editor/port';

/** What a template lays out inside its shape once that lands: its nodes where the template draws them, then the sequence flows between them. */
export type TemplateFlow = {
  nodes: { businessObject: ModelElement; bounds: Bounds }[];
  flows: ModelElement[];
};

/** Left covers the pool's label band. */
const POOL_PADDING = { left: 70, right: 40 };

/** Participants hold their flow inline (no drilldown), so grow the pool around the template's bounding box; returns the shift that moves the nodes into it. */
function fitParticipant(canvas: Canvas, pool: SceneNode, boxes: Bounds[]): { x: number; y: number } {
  if (pool.type !== 'bpmn:Participant' || boxes.length === 0) return { x: 0, y: 0 };

  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const bboxWidth = Math.max(...boxes.map((box) => box.x + box.width)) - minX;
  const bboxHeight = Math.max(...boxes.map((box) => box.y + box.height)) - minY;

  const width = Math.max(pool.width, bboxWidth + POOL_PADDING.left + POOL_PADDING.right);
  const height = Math.max(pool.height, bboxHeight + 80);
  canvas.resizeShape(pool, { x: pool.x, y: pool.y, width, height });

  return {
    x: pool.x + POOL_PADDING.left - minX,
    y: pool.y + Math.round((height - bboxHeight) / 2) - minY,
  };
}

/** Every id in a moddle subtree; references are not followed. */
function idsIn(value: any, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) idsIn(item, ids);
  } else if (value?.$descriptor) {
    if (typeof value.id === 'string') ids.add(value.id);
    for (const property of value.$descriptor.properties) if (!property.isReference) idsIn(value[property.name], ids);
  }
  return ids;
}

/** `value` with every renamed id rewritten, keys included, so an element and the text naming it (`state.trace.count('eo_gate')`) stay in one instance. */
function withIds(value: any, renamed: Map<string, string>): any {
  if (typeof value === 'string') return value.replace(/[\w-]+/g, (word) => renamed.get(word) ?? word);
  if (Array.isArray(value)) return value.map((item) => withIds(item, renamed));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [withIds(key, renamed), withIds(item, renamed)]));
  }
  return value;
}

/** The template's elements, built as a file holding them builds: each id kept where the document has it free, else suffixed. */
function buildElements(model: EditorModel, elements: Record<string, unknown>): any {
  const build = (spelled: Record<string, unknown>) => studyflowToDefinitions({ definitions: {}, elements: spelled }, model.moddle());
  const definitions = build(elements);
  const taken = [...idsIn(definitions.rootElements)].filter((id) => model.ids.assigned(id));
  if (taken.length === 0) return definitions;
  return build(withIds(elements, new Map(taken.map((id) => [id, model.ids.nextPrefixed(`${id}_`)]))));
}

/** The shape a palette drag drops for `template`, and the flow to lay out inside it once it lands. */
export function createTemplateElement(model: EditorModel, template: Template): { shape: ShapeDescriptor; flow: TemplateFlow } {
  const definitions = buildElements(model, template.elements);
  const root = definitions.rootElements[0];
  const isPool = root.$type === 'bpmn:Participant';
  const children: ModelElement[] = (isPool ? root.processRef : root)?.flowElements ?? [];
  // The canvas files each element as it lays it out; a pool takes its process from the canvas, only the flow from the template.
  if (isPool) root.set('processRef', undefined);
  else if (children.length > 0) root.set('flowElements', []);

  const bounds = new Map<ModelElement, Bounds>();
  for (const di of definitions.diagrams?.[0]?.plane?.planeElement ?? []) {
    if (di.bounds) bounds.set(di.bpmnElement, { x: di.bounds.x, y: di.bounds.y, width: di.bounds.width, height: di.bounds.height });
  }
  const isFlow = (bo: ModelElement): boolean => bo.$instanceOf('bpmn:SequenceFlow');

  return {
    // A container arrives collapsed, like a plain one from the palette; its flow is drawn once drilled into.
    shape: { type: root.$type, businessObject: root, ...(isExpandable(root.$type) ? { isExpanded: false } : {}) },
    flow: {
      nodes: children.filter((bo) => !isFlow(bo)).map((bo) => ({
        businessObject: bo,
        bounds: bounds.get(bo) ?? { x: 0, y: 0, ...defaultSizeFor(bo.$type) },
      })),
      flows: children.filter(isFlow),
    },
  };
}

/** Lay `flow` out inside `container`, the shape its template was dropped as. */
export function materializeTemplateFlow(canvas: Canvas, container: SceneNode, flow: TemplateFlow): void {
  const shift = fitParticipant(canvas, container, flow.nodes.map((node) => node.bounds));

  const placed = new Map<ModelElement, SceneNode>();
  for (const { businessObject, bounds } of flow.nodes) {
    const at = { ...bounds, x: bounds.x + shift.x, y: bounds.y + shift.y };
    const node = canvas.addElement({ type: businessObject.$type, businessObject }, at, container);
    if (node) placed.set(businessObject, node);
  }

  for (const sequenceFlow of flow.flows) {
    const source = placed.get(sequenceFlow.sourceRef);
    const target = placed.get(sequenceFlow.targetRef);
    if (!source || !target) {
      console.warn(`[templates] Skipping connection '${sequenceFlow.id}' - source or target not found.`);
      continue;
    }
    canvas.connectElements(source, target, sequenceFlow);
  }
}
