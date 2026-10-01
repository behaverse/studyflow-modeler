import { xmlToStudy } from '@core/document';
import { StudyModel, type Element } from '@core/model/index';
import { readStudy } from '@core/model/yaml';
import { buildExportModel, type ExportModel } from '@modeler/export/model';
import { freshMetamodel } from './schemas';
import { exampleXml } from './utils';

/** The interchange exporters' fixture: elements spelled as a file spells them, a study stand-in listing them, and the
 * shipped examples as models. */

export type FakeModelerOptions = {
  diagramName?: string;
};

/**
 * A partial `Editor`: the exporters list the study's elements, read each one off the study model, and take the
 * diagram's name off the root, and that is the whole of what they ask the editor for — which is why one study
 * stand-in serves every interchange format.
 */
function fakeModeler(model: StudyModel, { diagramName }: FakeModelerOptions = {}): any {
  const listed = [...model.elements()].filter((element) => !ROOT_TYPES.has(model.host(element)));
  return {
    study: {
      root: { id: 'Process_1', kind: 'root', type: 'bpmn:Process', ...(diagramName ? { name: diagramName } : {}) },
      list: () => listed.map((element) => ({ id: element.id, kind: 'node', type: model.host(element) })),
      model,
    },
  };
}

/** What the interchange exporters take: the semantic model of a process holding `elements`, as a file spells them. */
export function fakeExportModel(elements: Element[], options: FakeModelerOptions = {}): ExportModel {
  const metamodel = freshMetamodel();
  const doc = { id: 'D', definitions: { targetNamespace: 'http://bpmn.io/schema/bpmn' }, Process_1: { type: 'bpmn:Process', flowElements: elements } };
  return buildExportModel(fakeModeler(new StudyModel(readStudy(structuredClone(doc), metamodel, () => {}), metamodel), options));
}

/** An element of `bpmnType` a schema's `extensionType` extends, its attributes on the type's entry. */
export function wrapperElement(
  bpmnType: string,
  extensionType: string,
  { id, name, ...attributes }: Record<string, any>,
): Element {
  return { type: bpmnType, id, ...(name === undefined ? {} : { name }), extensionElements: [{ type: extensionType, ...attributes }] };
}

/** An activity's data edges: an input from `source`, an output into `target`. */
export function dataInput(source: Element): Element {
  return { type: 'bpmn:DataInputAssociation', sourceRef: [source.id!] };
}

export function dataOutput(target: Element): Element {
  return { type: 'bpmn:DataOutputAssociation', targetRef: target.id! };
}

/** The root elements a diagram is named after. */
const ROOT_TYPES = new Set(['bpmn:Process', 'bpmn:Collaboration', 'bpmn:Choreography']);

/** A shipped example as the exporters take it: its study model, every element listed, named after its root. */
export async function exampleExportModel(name: string): Promise<ExportModel> {
  const model = await xmlToStudy(await exampleXml(name), freshMetamodel());
  const root = model.study.roots.find((element) => ROOT_TYPES.has(model.host(element)));
  const exported = buildExportModel(fakeModeler(model, { diagramName: typeof root?.name === 'string' ? root.name : undefined }));
  // An empty model would pass every exporter's check while testing nothing.
  if (exported.elements.length === 0) throw new Error(`${name}: the export model holds no elements`);
  return exported;
}
