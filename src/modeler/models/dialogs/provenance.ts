import { primaryRoot, readTrail } from '@/modeler/models/provenanceTrail';
import { ICONS } from '@/icons';

/**
 * The provenance view's log lines: the document trail on the primary root,
 * merged with the per-element `executed` records a run leaves behind on the
 * copy it archives (see `assets/schemas/prov.moddle.yaml`).
 */

/** Which of the main palette's four group shapes an element type draws as
 *  (circle, box, diamond, cylinder — see `PALETTE_GROUPS`), by the BPMN
 *  local-name conventions extension types follow too (`*Task`, `*Gateway`,
 *  `*Event`, `Data*`). Anything task-like falls to the activity box. */
export function shapeIconOf(type: string): string {
  const local = type.split(':').pop() ?? '';
  if (local.endsWith('Gateway')) return ICONS.diamond;
  if (local.endsWith('Event')) return ICONS.circle;
  if (local.startsWith('Data')) return ICONS.database;
  return ICONS.square;
}

export type ProvenanceRecord = {
  /** Recommended vocabulary: `created`, `modified`, `imported`, `executed`; open. */
  action: string;
  when?: string;
  who?: string;
  with?: string;
  what?: string;
  run?: string;
  seed?: string;
  note?: string;
  /** Id of the element the entry hangs on (the primary root for document lines). */
  scopeId: string;
  /** Element name (or id) for element records; the root's id for document lines. */
  scopeLabel: string;
  /** True for trail entries on the primary root, false for per-element records. */
  isDocument: boolean;
  /** The scope's icon class: the element's palette shape, or the document icon. */
  icon?: string;
  /** The live `prov:Activity` moddle element this record projects — the
   *  handle invalidation needs to target exactly this entry. */
  entry: any;
  /** True on an `executed` record voided by a later `invalidated` marker on
   *  the same element (matching `run`, or a marker naming none). */
  invalidated?: boolean;
};

/** The element's `prov:Activity` extension entries, in document order. */
export function readActivities(bo: any): any[] {
  const values: any[] = bo?.extensionElements?.values ?? [];
  return values.filter((value) => value?.$type === 'prov:Activity');
}

function toRecord(
  activity: any,
  scope: { id: string; label: string; isDocument: boolean; icon?: string },
): ProvenanceRecord {
  return {
    action: activity.action || '(unspecified)',
    when: activity.when || undefined,
    who: activity.who || undefined,
    with: activity.with || undefined,
    what: activity.what || undefined,
    run: activity.run || undefined,
    seed: activity.seed || undefined,
    note: activity.note || undefined,
    scopeId: scope.id,
    scopeLabel: scope.label,
    isDocument: scope.isDocument,
    icon: scope.icon,
    entry: activity,
  };
}

/** Depth-first over `flowElements`, so activities inside subprocesses (and
 *  choreography tasks, which live in the same containment) are visited too. */
function walkFlowElements(container: any, visit: (el: any) => void): void {
  for (const el of container?.flowElements ?? []) {
    visit(el);
    walkFlowElements(el, visit);
  }
}

/**
 * Every provenance record in the document, oldest first: the document trail
 * plus per-element run records, merged chronologically. Undated entries sort
 * after dated ones; ties keep document order (root before elements).
 */
export function collectProvenance(definitions: any): ProvenanceRecord[] {
  const records: ProvenanceRecord[] = [];

  const root = primaryRoot(definitions);
  for (const entry of readTrail(definitions)) {
    records.push(toRecord(entry, {
      id: root?.id ?? '(document)',
      label: root?.name || root?.id || '(document)',
      isDocument: true,
      icon: ICONS.document,
    }));
  }

  for (const rootElement of definitions?.rootElements ?? []) {
    walkFlowElements(rootElement, (el) => {
      for (const entry of readActivities(el)) {
        records.push(toRecord(entry, {
          id: el.id || '(unnamed)',
          label: el.name || el.id || '(unnamed)',
          isDocument: false,
          icon: shapeIconOf(el.$type ?? ''),
        }));
      }
    });
  }

  // An `invalidated` marker voids its element's `executed` record of the
  // same run (or of any run, when the marker names none) — flagged here so
  // the view can show the record struck through rather than gone.
  for (const record of records) {
    if (record.isDocument || record.action !== 'executed') continue;
    record.invalidated = records.some((marker) =>
      marker.scopeId === record.scopeId
      && marker.action === 'invalidated'
      && (!marker.run || marker.run === record.run));
  }

  // Stamps may mix `Z` and local-offset forms, so compare instants rather
  // than strings; missing or unparseable `when`s sort last, keeping document
  // order among themselves (Array.prototype.sort is stable).
  const instant = (record: ProvenanceRecord): number => {
    const parsed = record.when ? Date.parse(record.when) : NaN;
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
  };
  return records.sort((a, b) => {
    const left = instant(a);
    const right = instant(b);
    if (left === right) return 0;
    return left < right ? -1 : 1;
  });
}

/** The detail facts of a record as `label: value` pairs, display order. */
export function recordDetails(record: ProvenanceRecord): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  if (record.who) pairs.push(['who', record.who]);
  if (record.with) pairs.push(['with', record.with]);
  if (record.run) pairs.push(['run', record.run]);
  if (record.seed) pairs.push(['seed', record.seed]);
  if (record.what) pairs.push(['what', record.what]);
  return pairs;
}
