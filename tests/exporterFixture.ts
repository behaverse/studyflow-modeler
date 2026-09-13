import { StudyflowElement } from '@core/element';
import { buildExportModel, type ExportModel } from '@modeler/export/model';
import { freshModdle } from './schemas';
import { exampleXml } from './utils';

/** The interchange exporters' fixture: a moddle to build elements with, an element-registry stand-in, and the shipped examples as models. */

export const moddle: any = freshModdle();

export type FakeModelerOptions = {
  diagramName?: string;
};

/**
 * A partial `Editor`: the exporters walk `elements` and read the diagram's name
 * off the root, and that is the whole of what they ask the editor for — which is
 * why one registry stand-in serves every interchange format.
 */
function fakeModeler(businessObjects: any[], { diagramName }: FakeModelerOptions = {}): any {
  const elements = businessObjects.map((bo) => ({ businessObject: bo, type: 'shape', id: bo.id }));
  const root = diagramName
    ? { businessObject: { $type: 'bpmn:Process', name: diagramName } }
    : undefined;

  return {
    canvas: {
      all: () => elements,
      getRoot: () => root,
      rootOf: () => root,
    },
  };
}

/** What the interchange exporters take: the semantic model over a stand-in registry. */
export function fakeExportModel(businessObjects: any[], options: FakeModelerOptions = {}): ExportModel {
  return buildExportModel(fakeModeler(businessObjects, options));
}

export function wrapperElement(
  bpmnType: string,
  extensionType: string,
  { id, name, ...attributes }: Record<string, any>,
): any {
  const bo = moddle.create(bpmnType, { id, ...(name === undefined ? {} : { name }) });
  StudyflowElement.fromBusinessObject(bo).ensureExtension(extensionType, moddle, attributes);
  return bo;
}

/** An activity's data edges: an input from `source`, an output into `target`. */
export function dataInput(source: any): any {
  return moddle.create('bpmn:DataInputAssociation', { sourceRef: [source] });
}

export function dataOutput(target: any): any {
  return moddle.create('bpmn:DataOutputAssociation', { targetRef: target });
}

/** The root elements a diagram is named after. */
const ROOT_TYPES = new Set(['bpmn:Process', 'bpmn:Collaboration', 'bpmn:Choreography']);

/** Stands in for the element registry: every identified element in the tree, diagram interchange excluded. */
function businessObjects(definitions: any): any[] {
  const out: any[] = [];
  const seen = new Set<any>();

  (function visit(node: any): void {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (typeof node.$type === 'string' && typeof node.id === 'string') out.push(node);
    for (const key of Object.keys(node)) {
      if (key.startsWith('$') || key === 'diagrams' || key === 'di') continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  })(definitions);

  return out;
}

/** A shipped example as the exporters take it: its XML parsed, every element registered, named after its root. */
export async function exampleExportModel(name: string): Promise<ExportModel> {
  const { rootElement: definitions } = await freshModdle().fromXML(await exampleXml(name));
  const root = (definitions.rootElements ?? []).find((element: any) => ROOT_TYPES.has(element.$type));
  const model = fakeExportModel(businessObjects(definitions), { diagramName: root?.name });
  // An empty model would pass every exporter's check while testing nothing.
  if (model.elements.length === 0) throw new Error(`${name}: the export model holds no elements`);
  return model;
}
