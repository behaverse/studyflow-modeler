import type { StudyModel } from '@core/model/index';
import { META_KEY } from '@core/model/state';
import type { Editor } from '@modeler/editor/port';

export type TrailStamp = {
  action: string;
  when: string;
  who?: string;
  with?: string;
  what?: string;
  run?: string;
  seed?: string | number;
  note?: string;
};

/** One run record in `state._meta.prov`: the fields of `prov:Activity`, as a plain object. */
export type TrailRecord = TrailStamp;

const RECORD_FIELDS = ['action', 'when', 'who', 'with', 'what', 'run', 'seed', 'note'] as const;

function toRecord(source: TrailStamp): TrailRecord {
  const record: Record<string, any> = {};
  for (const field of RECORD_FIELDS) {
    let value = source[field];
    if (value == null || value === '') continue;
    if (field === 'seed' && typeof value === 'string' && /^-?\d+$/.test(value)) value = Number(value);
    record[field] = value;
  }
  return record as TrailRecord;
}

/** The study's run records, oldest first: `state._meta.prov`. */
export function readTrail(model: StudyModel): TrailRecord[] {
  const prov = (model.study.state?.[META_KEY] as { prov?: unknown } | undefined)?.prov;
  return Array.isArray(prov) ? prov : [];
}

/** ISO 8601 at second precision, in this machine's timezone. */
export function trailTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Appends to `state._meta.prov`. Returns the record. */
export function appendTrailEntry(model: StudyModel, stamp: TrailStamp): TrailRecord | undefined {
  if (!model.primaryRoot()) return undefined;
  const tree = (model.study.state ??= {}) as Record<string, any>;
  const meta = tree[META_KEY] && typeof tree[META_KEY] === 'object' ? tree[META_KEY] : (tree[META_KEY] = {});
  const prov: TrailRecord[] = Array.isArray(meta.prov) ? meta.prov : (meta.prov = []);
  const record = toRecord(stamp);
  prov.push(record);
  return record;
}

const lastStampedAt = new WeakMap<object, number>();

export function resetTrailStamping(modeler: Editor): void {
  // An import moves the revision without an edit, so the baseline re-anchors to it: a
  // reopened trail-carrying document nobody edits is left untouched.
  lastStampedAt.set(modeler, modeler.revision());
}

export function stampTrailForExport(
  modeler: Editor,
  identity: { who?: string; tool: string },
): TrailRecord | undefined {
  const revision = modeler.revision();
  const trail = readTrail(modeler.study.model);
  // A never-reset baseline is the counter's starting value (0): fresh port, no edits.
  const edited = revision !== (lastStampedAt.get(modeler) ?? 0);
  if (trail.length > 0 && !edited) return undefined;

  // One commit of the study, so the stamp is in its history: an undo after a save takes it back with the edit it
  // follows, and a redo brings it back, rather than the history forgetting a write made beside it.
  let entry: TrailRecord | undefined;
  modeler.study.revise(modeler.study.root.id, (_root, model) => {
    entry = appendTrailEntry(model, {
      action: trail.length === 0 ? 'created' : 'modified',
      when: trailTimestamp(),
      who: identity.who,
      with: identity.tool,
    });
  });
  // The stamp is itself a commit: the baseline is the revision after it, so it never counts as an edit.
  if (entry) lastStampedAt.set(modeler, modeler.revision());
  return entry;
}
