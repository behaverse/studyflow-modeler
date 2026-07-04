import { getDefaults, StudyflowElement } from '@/core/extensions';
import { toLocalName } from '@/core/naming';

export type BuildBusinessObjectOptions = {
  attributes?: Record<string, unknown>;
  extensionType?: string;
  /** If provided, used verbatim; otherwise generated via moddle.ids. */
  id?: string;
};

/** Build a BPMN business object, attaching an extension wrapper when `extensionType` is given. */
export function buildBusinessObject(
  modeler: any,
  bpmnType: string,
  { attributes = {}, extensionType, id }: BuildBusinessObjectOptions = {},
): any {
  const bpmnFactory = modeler.get('bpmnFactory');
  const moddle = modeler.get('moddle');
  const ids = moddle?.ids;

  const idBase = extensionType ?? bpmnType;
  const idPrefix = `${toLocalName(idBase) ?? idBase}_`;

  const generatedId =
    id
    ?? (attributes as { id?: string }).id
    ?? (ids?.nextPrefixed ? ids.nextPrefixed(idPrefix, { $type: bpmnType } as any) : undefined);

  const bo = bpmnFactory.create(bpmnType, {
    ...attributes,
    ...(generatedId ? { id: generatedId } : {}),
  });

  bo.id = bo.id || (ids?.nextPrefixed ? ids.nextPrefixed(idPrefix, bo) : undefined);

  if (extensionType) {
    const defaults = getDefaults(extensionType);
    StudyflowElement.fromBusinessObject(bo).ensureExtension(extensionType, moddle, defaults);
  }

  return bo;
}
