import {
  createExtensionElement,
  getDefaults,
  isExtendsType,
  setAppliedType,
} from '../../extensions';
import { toLocalName } from '../../utils/naming';

export type BuildBusinessObjectOptions = {
  /** Attributes set on the BO during creation (name, custom properties, etc.). */
  attrs?: Record<string, unknown>;
  /** Studyflow extension type (e.g. 'studyflow:CognitiveTask'). */
  studyflowType?: string;
  /** If provided, used verbatim; otherwise generated via moddle.ids. */
  id?: string;
};

/**
 * Build a new business object for a BPMN element, attaching a studyflow
 * extension if one is given.
 *
 * - For **extends-based** studyflow types: defaults are merged into the BO's
 *   own properties, and the applied-type attribute is set.
 * - For **classic extension** types: an extensionElement wrapper is attached
 *   with defaults applied.
 *
 * Reads `bpmnFactory` + `moddle` from the modeler, but does not touch the
 * canvas or modeling service — the caller decides how to place the BO
 * (drag-create via `create.start`, immediate via `modeling.createShape`).
 */
export function buildBusinessObject(
  modeler: any,
  bpmnType: string,
  { attrs = {}, studyflowType, id }: BuildBusinessObjectOptions = {},
): any {
  const bpmnFactory = modeler.get('bpmnFactory');
  const moddle = bpmnFactory._model;
  const ids = moddle?.ids;

  const isExtends = studyflowType ? isExtendsType(studyflowType, moddle) : false;

  // For extends-based types, merge defaults into the creation payload so
  // they land directly on the BO without a second .set() pass.
  const extendsDefaults = isExtends
    ? getDefaults(studyflowType as string, moddle)
    : {};

  const idBase = studyflowType ?? bpmnType;
  const idPrefix = `${toLocalName(idBase) ?? idBase}_`;

  const generatedId =
    id
    ?? (attrs as { id?: string }).id
    ?? (ids?.nextPrefixed ? ids.nextPrefixed(idPrefix, { $type: bpmnType } as any) : undefined);

  const businessObject = bpmnFactory.create(bpmnType, {
    ...extendsDefaults,
    ...attrs,
    ...(generatedId ? { id: generatedId } : {}),
  });

  businessObject.id = businessObject.id
    || (ids?.nextPrefixed ? ids.nextPrefixed(idPrefix, businessObject) : undefined);

  if (studyflowType) {
    if (isExtends) {
      setAppliedType(businessObject, studyflowType);
    } else {
      const defaults = getDefaults(studyflowType, moddle);
      createExtensionElement(businessObject, studyflowType, moddle, defaults);
    }
  }

  return businessObject;
}
