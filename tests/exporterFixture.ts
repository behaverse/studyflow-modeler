import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '../src/core/notation';
import { StudyflowElement } from '../src/core/element';
import { toModdlePackages } from '../src/core/notation/schemaFile';
import { loadSchemaModels } from './schemas';

/** The interchange exporters' fixture: the compiled catalog and moddle, plus an element-registry stand-in. */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));

export const moddle: any = new BpmnModdle(
  Object.fromEntries(models.map((model) => [model.prefix, toModdlePackages(model, models)])),
) as any;

export type FakeModelerOptions = {
  diagramName?: string;
};

export function fakeModeler(businessObjects: any[], { diagramName }: FakeModelerOptions = {}): any {
  const elements = businessObjects.map((bo) => ({ businessObject: bo, type: 'shape', id: bo.id }));
  const root = diagramName
    ? { businessObject: { $type: 'bpmn:Process', name: diagramName } }
    : undefined;

  return {
    get: (service: string) => {
      if (service === 'elementRegistry') return { forEach: (fn: any) => elements.forEach(fn) };
      if (service === 'canvas') return { getRootElement: () => root };
      return undefined;
    },
  };
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
