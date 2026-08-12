import { primaryRoot, readTrail } from '@modeler/provenance/trail';
import { ICONS } from '@modeler/icons';

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
  seed?: number;
  note?: string;
  scopeId: string;
  scopeLabel: string;
  isDocument: boolean;
  icon?: string;
  /** The live `prov:Activity` moddle element this record projects. */
  entry: any;
  invalidated?: boolean;
};

function readActivities(bo: any): any[] {
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

function walkFlowElements(container: any, visit: (el: any) => void): void {
  for (const el of container?.flowElements ?? []) {
    visit(el);
    walkFlowElements(el, visit);
  }
}

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

  // An `invalidated` marker voids its element's `executed` record of the same run (or any, when it names none).
  for (const record of records) {
    if (record.isDocument || record.action !== 'executed') continue;
    record.invalidated = records.some((marker) =>
      marker.scopeId === record.scopeId
      && marker.action === 'invalidated'
      && (!marker.run || marker.run === record.run));
  }

  // Stamps mix `Z` and local-offset forms, so compare instants; unparseable `when`s sort last, stably.
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

export function recordDetails(record: ProvenanceRecord): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  if (record.who) pairs.push(['who', record.who]);
  if (record.with) pairs.push(['with', record.with]);
  if (record.run) pairs.push(['run', record.run]);
  // `!= null` rather than truthiness: 0 is a perfectly good seed.
  if (record.seed != null) pairs.push(['seed', String(record.seed)]);
  if (record.what) pairs.push(['what', record.what]);
  return pairs;
}
