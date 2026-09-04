import { META_KEY, primaryRoots, readState, writeState } from '@core/document';
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

export function primaryRoot(definitions: any): any | undefined {
  return primaryRoots(definitions)[0];
}

/** The pre-`state` document trail: `prov:Activity` values on a root's `extensionElements`. */
function legacyTrailRoot(definitions: any): any | undefined {
  return primaryRoots(definitions).find((root) => legacyEntries(root).length > 0);
}

function legacyEntries(root: any): any[] {
  const values: any[] = root?.extensionElements?.values ?? [];
  return values.filter((value) => value?.$type === 'prov:Activity');
}

function toRecord(source: any): TrailRecord {
  const record: Record<string, any> = {};
  for (const field of RECORD_FIELDS) {
    let value = typeof source?.get === 'function' ? source.get(field) : source?.[field];
    if (value == null || value === '') continue;
    if (field === 'seed' && typeof value === 'string' && /^-?\d+$/.test(value)) value = Number(value);
    record[field] = value;
  }
  return record as TrailRecord;
}

/** The study's run records, oldest first: `state._meta.prov`, else a legacy root trail (read-only). */
export function readTrail(definitions: any): TrailRecord[] {
  const prov = readState(definitions)[META_KEY]?.prov;
  if (Array.isArray(prov)) return prov;
  return legacyEntries(legacyTrailRoot(definitions)).map(toRecord);
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

/** Appends to `state._meta.prov`, first moving any legacy root entries there. Returns the record. */
export function appendTrailEntry(
  definitions: any,
  moddle: any,
  stamp: TrailStamp,
): TrailRecord | undefined {
  if (!primaryRoot(definitions)) return undefined;

  const tree = readState(definitions);
  const meta = tree[META_KEY] && typeof tree[META_KEY] === 'object' ? tree[META_KEY] : (tree[META_KEY] = {});
  const prov: TrailRecord[] = Array.isArray(meta.prov) ? meta.prov : (meta.prov = []);

  const legacyRoot = legacyTrailRoot(definitions);
  if (legacyRoot) {
    prov.push(...legacyEntries(legacyRoot).map(toRecord));
    legacyRoot.extensionElements.values = legacyRoot.extensionElements.values
      .filter((value: any) => value?.$type !== 'prov:Activity');
  }

  const record = toRecord(stamp);
  prov.push(record);
  writeState(definitions, moddle, tree);
  return record;
}

const lastStampedAt = new WeakMap<object, number>();

export function resetTrailStamping(modeler: Editor): void {
  // Import clears the edit history without moving the revision counter, so the
  // baseline re-anchors to the current revision: a reopened trail-carrying
  // document nobody edits is left untouched.
  lastStampedAt.set(modeler, modeler.revision());
}

export function stampTrailForExport(
  modeler: Editor,
  identity: { who?: string; tool: string },
): TrailRecord | undefined {
  const definitions = modeler.getDefinitions();
  if (!definitions) return undefined;

  const revision = modeler.revision();
  const trail = readTrail(definitions);
  // A never-reset baseline is the counter's starting value (0): fresh port, no edits.
  const edited = revision !== (lastStampedAt.get(modeler) ?? 0);
  if (trail.length > 0 && !edited) return undefined;

  const entry = appendTrailEntry(definitions, modeler.model.moddle(), {
    action: trail.length === 0 ? 'created' : 'modified',
    when: trailTimestamp(),
    who: identity.who,
    with: identity.tool,
  });
  if (entry) lastStampedAt.set(modeler, revision);
  return entry;
}
