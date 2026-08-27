import { getDefaults, StudyflowElement } from '@core/element';
import { toLocalName } from '@core/naming';
import type { EditorModel } from '@modeler/editor/port';

export type BuildBusinessObjectOptions = {
  attributes?: Record<string, unknown>;
  extensionType?: string;
  id?: string;
};

/**
 * Mint a business object for `bpmnType`. Takes the `EditorModel` slice rather than a
 * whole port: the palette, the append menu and the template factory all reach the
 * same document model, and none of them needs anything else off the port.
 */
export function buildBusinessObject(
  model: EditorModel,
  bpmnType: string,
  { attributes = {}, extensionType, id }: BuildBusinessObjectOptions = {},
): any {
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
