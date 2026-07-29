import { isBpmnSubtypeOf } from '@/core/catalog/bpmn';
import type { AttributeSpec, TypeRole } from '@/core/catalog/types';

/**
 * Roles a type has by virtue of its shape, so most types never declare one.
 *
 * A role answers "what kind of thing is this?" — the question consumers ask
 * instead of naming types (see `TypeRole`). Most of the time the schema has
 * already answered it structurally: what the type attaches to in BPMN, and
 * which attributes it declares. Inference runs over the *effective* type — the
 * resolved BPMN attach point and the inherited attribute set — so a subtype
 * gets its supertype's roles without restating them, through the same
 * `superClass`/`extends` graph moddle itself resolves.
 *
 * `meta.roles` remains for the facts no structure implies (a Timeseries is a
 * sampled signal; an OpenBCI session is an acquisition) and only ever *adds*
 * to what is inferred here.
 */

/**
 * Attribute a type declares -> the role declaring it implies.
 *
 * These are domain vocabulary, not type names: any schema whose type declares
 * `instrument` is a participant-facing instrument, which is already how
 * `isDataOperationActivity` reads that attribute.
 */
const ROLE_BY_ATTRIBUTE: Record<string, TypeRole> = {
  instrument: 'instrument',
  samplingRate: 'signal',
  device: 'acquisition',
};

export function inferRoles(bpmnType: string | null, attributes: AttributeSpec[]): TypeRole[] {
  const roles = new Set<TypeRole>();

  // BPMN's own word for "carries data" — the same test the palette files a
  // type under its Data group with.
  if (bpmnType && isBpmnSubtypeOf(bpmnType, 'bpmn:ItemAwareElement')) roles.add('data-element');

  for (const spec of attributes) {
    const role = ROLE_BY_ATTRIBUTE[spec.ns.localName];
    if (role) roles.add(role);
  }

  return [...roles];
}
