import { getDefaults, StudyflowElement } from '@core/element';
import { toLocalName } from '@core/naming';

/** The document-model slice a palette needs to mint a business object. */
export interface BusinessObjectModel {
  moddle(): any;
  createBusinessObject(type: string, properties?: Record<string, unknown>): any;
  ids: { nextPrefixed(prefix: string, element?: unknown): string };
}

export type BuildBusinessObjectOptions = {
  attributes?: Record<string, unknown>;
  extensionType?: string;
  id?: string;
};

export function buildBusinessObject(
  model: BusinessObjectModel,
  bpmnType: string,
  { attributes = {}, extensionType, id }: BuildBusinessObjectOptions = {},
): any {
  const hasIds = !!(model.moddle() as any)?.ids?.nextPrefixed;
  const idBase = extensionType ?? bpmnType;
  const idPrefix = `${toLocalName(idBase) ?? idBase}_`;
  const generatedId = id
    ?? (attributes as { id?: string }).id
    ?? (hasIds ? model.ids.nextPrefixed(idPrefix, { $type: bpmnType }) : undefined);
  const bo = model.createBusinessObject(bpmnType, { ...attributes, ...(generatedId ? { id: generatedId } : {}) });
  bo.id = bo.id || (hasIds ? model.ids.nextPrefixed(idPrefix, bo) : undefined);
  if (extensionType) {
    StudyflowElement.fromBusinessObject(bo).ensureExtension(extensionType, model.moddle(), getDefaults(extensionType));
  }
  return bo;
}
