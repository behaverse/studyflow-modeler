import type { ChangedIds, ElementRecord, Study } from '@canvas/index.ts';
import type { ReviewChange } from '@modeler/review/store';

const localName = (type: string): string => type.split(':').pop() ?? type;

/** The record's name and type, as a row of the list says them. */
function named(record: ElementRecord | undefined, id: string): Pick<ReviewChange, 'label' | 'type'> {
  return { label: record?.name?.trim() || id, type: localName(record?.extension ?? record?.type ?? '') };
}

/** What changed of `id` between the two versions: its attributes by name, and `drawing` when it moved or was reshaped. */
function whatChanged(id: string, before: Study, after: Study): string[] {
  const values = (study: Study): Map<string, string> =>
    new Map((study.attributes(id) ?? []).map((attribute) => [attribute.name, JSON.stringify(attribute.value ?? null)]));
  const was = values(before);
  const is = values(after);
  const what = [...new Set([...was.keys(), ...is.keys()])].filter((name) => was.get(name) !== is.get(name));
  const drawing = (study: Study): string => {
    const record = study.get(id);
    return JSON.stringify([record?.bounds ?? null, record?.waypoints ?? null]);
  };
  return drawing(before) === drawing(after) ? what : [...what, 'drawing'];
}

/**
 * The change list of a version under review: what `ids` (the study's answer to `adopt`) names, read from the version
 * before it for what went and from the one after it for the rest.
 */
export function describeChanges(ids: ChangedIds, before: Study, after: Study): ReviewChange[] {
  return [
    ...ids.added.map((id): ReviewChange => ({ id, kind: 'added', ...named(after.get(id), id), what: [] })),
    ...ids.changed.map((id): ReviewChange => ({ id, kind: 'changed', ...named(after.get(id), id), what: whatChanged(id, before, after) })),
    ...ids.removed.map((id): ReviewChange => ({ id, kind: 'removed', ...named(before.get(id), id), what: [] })),
  ];
}
