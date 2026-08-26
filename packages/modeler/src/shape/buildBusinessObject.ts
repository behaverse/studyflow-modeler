import { getDefaults, StudyflowElement } from '@core/element';
import { toLocalName } from '@core/naming';
import { createEditorModel } from '@modeler/editor/bpmnAdapter';
import type { ServiceResolver } from '@modeler/bpmn/types';

export type BuildBusinessObjectOptions = {
  attributes?: Record<string, unknown>;
  extensionType?: string;
  id?: string;
};

export function buildBusinessObject(
  modeler: ServiceResolver,
  bpmnType: string,
  { attributes = {}, extensionType, id }: BuildBusinessObjectOptions = {},
): any {
  // Resolver rather than the full port: the append menu hands this an injector.
  const model = createEditorModel(modeler);
  // `ids` may be absent on a bare moddle; keep the defensive probe.
  const hasIds = !!(model.moddle() as any)?.ids?.nextPrefixed;

  const idBase = extensionType ?? bpmnType;
  const idPrefix = `${toLocalName(idBase) ?? idBase}_`;

  const generatedId =
    id
    ?? (attributes as { id?: string }).id
    ?? (hasIds ? model.ids.nextPrefixed(idPrefix, { $type: bpmnType }) : undefined);

  const bo = model.createBusinessObject(bpmnType, {
    ...attributes,
    ...(generatedId ? { id: generatedId } : {}),
  });

  bo.id = bo.id || (hasIds ? model.ids.nextPrefixed(idPrefix, bo) : undefined);

  if (extensionType) {
    const defaults = getDefaults(extensionType);
    StudyflowElement.fromBusinessObject(bo).ensureExtension(extensionType, model.moddle(), defaults);
  }

  return bo;
}
