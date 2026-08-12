import { getDefaults, StudyflowElement } from '@core/element';
import { toLocalName } from '@core/naming';
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
  const bpmnFactory = modeler.get('bpmnFactory');
  const moddle = modeler.get('moddle');
  // `ids.nextPrefixed` takes (prefix, element); bpmn-moddle types only the prefix.
  const ids = moddle?.ids;

  const idBase = extensionType ?? bpmnType;
  const idPrefix = `${toLocalName(idBase) ?? idBase}_`;

  const generatedId =
    id
    ?? (attributes as { id?: string }).id
    ?? (ids?.nextPrefixed ? (ids.nextPrefixed as any)(idPrefix, { $type: bpmnType }) : undefined);

  const bo = bpmnFactory.create(bpmnType, {
    ...attributes,
    ...(generatedId ? { id: generatedId } : {}),
  });

  bo.id = bo.id || (ids?.nextPrefixed ? (ids.nextPrefixed as any)(idPrefix, bo) : undefined);

  if (extensionType) {
    const defaults = getDefaults(extensionType);
    StudyflowElement.fromBusinessObject(bo).ensureExtension(extensionType, moddle, defaults);
  }

  return bo;
}
