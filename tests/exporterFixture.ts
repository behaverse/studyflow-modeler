import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '@core/notation';
import { StudyflowElement } from '@core/element';
import { toModdlePackages } from '@core/notation/schemaFile';
import { buildExportModel, type ExportModel } from '@modeler/export/model';
import { loadSchemaModels } from './schemas';

/** The interchange exporters' fixture: the compiled catalog and moddle, plus an element-registry stand-in. */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));

const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

export const moddle: any = new BpmnModdle(packages) as any;

/** A moddle of its own, for tests that parse documents (moddle mutates the packages it is handed). */
export function makeModdle(): any {
  return new BpmnModdle(structuredClone(packages)) as any;
}

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
    elements: {
      forEach: (fn: any) => elements.forEach(fn),
      root: () => root,
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
