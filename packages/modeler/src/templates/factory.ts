import { defaultSizeFor, isExpandable, type Bounds, type Canvas, type SceneNode, type ShapeDescriptor } from '@canvas/index.ts';
import { PLACEHOLDER, studyflowToDefinitions } from '@core/document';
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

/** Every moddle element in a subtree; references are not followed. */
function* elementsIn(value: any): Generator<ModelElement> {
  if (Array.isArray(value)) {
    for (const item of value) yield* elementsIn(item);
  } else if (value?.$descriptor) {
    yield value;
    for (const property of value.$descriptor.properties) if (!property.isReference) yield* elementsIn(value[property.name]);
  }
}

/** Renamed ids where code names them: every word of an expression's body, and the name in each `{placeholder}`. */
function renameInCode(element: ModelElement, renamed: Map<string, string>): void {
  const inPlaceholders = (text: string): string => text.replace(PLACEHOLDER, (match, path: string) => {
    const head = path.split('.')[0];
    return renamed.has(head) ? match.replace(head, renamed.get(head)!) : match;
  });
  const isExpression = element.$instanceOf('bpmn:Expression');
  for (const property of element.$descriptor.properties) {
    const value = element[property.name];
    if (property.isReference || property.name === 'id') continue;
    if (isExpression && property.name === 'body' && typeof value === 'string') {
      element.set('body', value.replace(/[\p{L}\p{N}_-]+/gu, (word) => renamed.get(word) ?? word));
    } else if (typeof value === 'string') {
      element.set(property.name, inPlaceholders(value));
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      element.set(property.name, value.map(inPlaceholders));
    }
  }
  for (const [name, value] of Object.entries(element.$attrs ?? {})) {
    if (typeof value === 'string') element.$attrs[name] = inPlaceholders(value);
  }
}

/**
 * The template's elements, built as a file holding them builds. An id the open document already holds is suffixed
 * (a second drop gets `eo_gate_…`): references follow the element they point at, and so does code that names it by
 * text, an expression (`state.trace.count('eo_gate')`) or a `{placeholder}`. Names and documentation keep the word.
 */
function buildElements(model: EditorModel, elements: Record<string, unknown>, document: ModelElement | undefined): any {
  const definitions = studyflowToDefinitions({ definitions: {}, elements }, model.moddle());
  const held = new Set([...elementsIn(document)].map((element) => element.id));
  const renamed = new Map<string, string>();
  for (const element of elementsIn(definitions.rootElements)) {
    if (typeof element.id !== 'string' || !held.has(element.id)) continue;
    const id = model.ids.nextPrefixed(`${element.id}_`);
    renamed.set(element.id, id);
    element.id = id;
  }
  if (renamed.size > 0) for (const element of elementsIn(definitions.rootElements)) renameInCode(element, renamed);
  return definitions;
}

/** The shape a palette drag drops for `template` into `document`, and the flow to lay out inside it once it lands. */
export function createTemplateElement(
  model: EditorModel,
  template: Template,
  document: ModelElement | undefined,
): { shape: ShapeDescriptor; flow: TemplateFlow } {
  const definitions = buildElements(model, template.elements, document);
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
