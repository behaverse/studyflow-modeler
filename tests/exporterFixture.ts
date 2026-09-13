import { StudyflowElement } from '@core/element';
import { buildExportModel, type ExportModel } from '@modeler/export/model';
import { freshModdle } from './schemas';

/** The interchange exporters' fixture: a moddle to build elements with, plus an element-registry stand-in. */

export const moddle: any = freshModdle();

export type FakeModelerOptions = {
  diagramName?: string;
};

/**
 * A partial `Editor`: the exporters walk `elements` and read the diagram's name
 * off the root, and that is the whole of what they ask the editor for — which is
 * why one registry stand-in serves every interchange format.
 */
export function fakeModeler(businessObjects: any[], { diagramName }: FakeModelerOptions = {}): any {
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
