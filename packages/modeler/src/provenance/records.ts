import { primaryRoot, readTrail } from '@modeler/provenance/trail';
import { ICONS } from '@modeler/icons';

/** Icons only where the shape says something at a glance: gateways, events, containers; the rest stay bare. */
export function shapeIconOf(el: any): string | undefined {
  if (el?.$instanceOf?.('bpmn:Gateway')) return ICONS.diamond;
  if (el?.$instanceOf?.('bpmn:Event')) return ICONS.circle;
  if (el?.$instanceOf?.('bpmn:SubProcess')) return ICONS.plusBox;
  return undefined;
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
  /** An `invalidated` marker whose named record no longer stands: inert history, never voids or branches again. */
  consumed?: boolean;
  /** An `executed` record a later run superseded: the first branch's history; a newer record stands. */
  superseded?: boolean;
  /** The element's current record: executed, not voided, not superseded, the only kind ✕ can invalidate. */
  standing?: boolean;
};

/** A marker without `what` voids by run, or by a none run. */
export function voids(
  marker: { what?: string; run?: string },
  record: { when?: string; run?: string },
): boolean {
  return marker.what ? marker.what === record.when : (!marker.run || marker.run === record.run);
}

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
    // `!= null` rather than truthiness: 0 is a perfectly good seed.
    seed: activity.seed != null ? activity.seed : undefined,
    note: activity.note || undefined,
    scopeId: scope.id,
    scopeLabel: scope.label,
    isDocument: scope.isDocument,
    icon: scope.icon,
    entry: activity,
  };
}

// Stamps mix `Z` and local-offset forms, so compare instants; unparseable `when`s sort last, stably.
function instant(record: ProvenanceRecord): number {
  const parsed = record.when ? Date.parse(record.when) : NaN;
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function walkFlowElements(container: any, visit: (el: any) => void): void {
  for (const el of container?.flowElements ?? []) {
    visit(el);
    walkFlowElements(el, visit);
  }
}

/** Longest-path rank of every flow element, over sequence flows plus data reads and writes.
 * The runner's stamps have second precision, so same-second ties are constant, and the diagram
 * itself says what must have come first. Children rank inside their subprocess's own slot. */
function flowRanks(definitions: any): Map<string, number> {
  const ranks = new Map<string, number>();
  const rankContainer = (container: any, base: number, span: number): void => {
    const els: any[] = (container?.flowElements ?? []).filter((el: any) => el.id);
    if (!els.length) return;
    const byId = new Set(els.map((el) => el.id));
    const preds = new Map<string, Array<[string, number]>>(els.map((el) => [el.id, []]));
    const link = (fromRef: any, toRef: any, weight: number) => {
      if (fromRef?.id && toRef?.id && byId.has(fromRef.id) && byId.has(toRef.id)) {
        preds.get(toRef.id)!.push([fromRef.id, weight]);
      }
    };
    for (const el of els) {
      if (el.sourceRef && el.targetRef) link(el.sourceRef, el.targetRef, 1);
      // Half steps: an activity's outputs appear right after it, before the flow moves on.
      for (const assoc of el.dataInputAssociations ?? []) link(assoc.sourceRef?.[0], el, 0.5);
      for (const assoc of el.dataOutputAssociations ?? []) link(el, assoc.targetRef, 0.5);
    }
    const depths = new Map<string, number>();
    const depthOf = (id: string, stack: Set<string>): number => {
      if (depths.has(id)) return depths.get(id)!;
      if (stack.has(id)) return 0; // a loop back through a gateway breaks here
      stack.add(id);
      const depth = Math.max(0, ...preds.get(id)!.map(([p, w]) => depthOf(p, stack) + w));
      stack.delete(id);
      depths.set(id, depth);
      return depth;
    };
    for (const el of els) depthOf(el.id, new Set());
    const unit = span / (Math.max(...depths.values()) + 2);
    for (const el of els) {
      const rank = base + (depths.get(el.id)! + 1) * unit;
      ranks.set(el.id, rank);
      rankContainer(el, rank, unit);
    }
  };
  for (const root of definitions?.rootElements ?? []) rankContainer(root, 0, 1);
  return ranks;
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
          icon: shapeIconOf(el),
        }));
      }
    });
  }

  applyStatuses(records);

  // Stamps have second precision, so kind breaks a same-second tie first.
  const tieRank = (record: ProvenanceRecord): number =>
    record.action === 'invalidated' ? 0 : record.isDocument ? 1 : 2;
  const ranks = flowRanks(definitions);
  return records.sort((a, b) => {
    const left = instant(a);
    const right = instant(b);
    if (left !== right) return left < right ? -1 : 1;
    const tie = tieRank(a) - tieRank(b);
    if (tie !== 0) return tie;
    // Same second, both element records: the flow graph decides, data before its consumers.
    return (ranks.get(a.scopeId) ?? 0) - (ranks.get(b.scopeId) ?? 0);
  });
}

/** Re-derives every status flag from the records given: the full trail, or any oldest-first prefix
 * of it (the replay slider hands in clones, so the live records keep their final flags). */
export function applyStatuses(records: ProvenanceRecord[]): ProvenanceRecord[] {
  // One pass per element: its executed chain (in document = chronological order) and its markers.
  const chains = new Map<string, ProvenanceRecord[]>();
  const markers: ProvenanceRecord[] = [];
  for (const record of records) {
    if (record.isDocument) continue;
    if (record.action === 'executed') {
      chains.set(record.scopeId, [...(chains.get(record.scopeId) ?? []), record]);
    } else if (record.action === 'invalidated') {
      markers.push(record);
    }
  }
  for (const chain of chains.values()) {
    for (const record of chain) {
      record.invalidated = markers.some((m) => m.scopeId === record.scopeId && voids(m, record));
      // A branching run keeps the records it supersedes: the first branch's history, not standing.
      record.superseded = chain.some((later) => later !== record && instant(later) > instant(record));
      record.standing = !record.invalidated && !record.superseded;
    }
  }
  // A precise marker whose named record no longer stands is consumed history; coarse ones never age out.
  for (const marker of markers) {
    if (!marker.what) continue;
    const named = chains.get(marker.scopeId)?.find((r) => r.when === marker.what);
    marker.consumed = !named || !!named.superseded;
  }
  return records;
}

/** Display only; `collectProvenance` stays strictly oldest-first. */
export function displayOrder(records: ProvenanceRecord[]): ProvenanceRecord[] {
  for (const marker of [...records]) {
    if (marker.isDocument || marker.action !== 'invalidated' || !marker.what) continue;
    const at = records.indexOf(marker);
    records.splice(at, 1);
    const target = records.findIndex((r) =>
      r.scopeId === marker.scopeId && r.action === 'executed' && r.when === marker.what);
    records.splice(target < 0 ? at : target + 1, 0, marker);
  }
  return records;
}

export type GraphLine = { lane: number; fromDot: boolean; fromCurve: boolean; toDot: boolean };
export type GraphInfo = {
  lane: number;
  laneCount: number;
  /** Lane lines passing through this row, ends trimmed to the dot where a lane starts or stops. */
  lines: GraphLine[];
  /** A consumed marker row where its branch opens: the curve leaves this row's dot into that lane. */
  opens?: number;
  /** An active precise marker: the next run branches here, drawn as a dashed stub. */
  pendingBranch?: boolean;
};

/** `git log --graph` derived from the document: no repository here. */
export function assignLanes(records: ProvenanceRecord[]): Map<ProvenanceRecord, GraphInfo> {
  const stamps = records.filter((r) => r.isDocument && r.action === 'executed');
  const branchMarker = new Map<ProvenanceRecord, ProvenanceRecord>();
  for (const marker of records) {
    if (marker.isDocument || marker.action !== 'invalidated') continue;
    if (!marker.consumed) {
      // An armed precise marker with a run stamp after it: that run branched at its very start,
      // even while its re-run of the step is still on the way (mid-replay, or a run that died).
      if (!marker.what) continue;
      const stamp = stamps.find((s) => instant(s) > instant(marker));
      if (stamp && !branchMarker.has(stamp)) branchMarker.set(stamp, marker);
      continue;
    }
    const chain = records.filter((r) =>
      !r.isDocument && r.scopeId === marker.scopeId && r.action === 'executed');
    const named = chain.findIndex((r) => r.when === marker.what);
    const fresh = named >= 0 ? chain[named + 1] : chain.find((r) => instant(r) > instant(marker));
    if (!fresh) continue;
    const stamp = stamps.findLast((s) => instant(s) <= instant(fresh));
    if (stamp && !branchMarker.has(stamp)) branchMarker.set(stamp, marker);
  }
  const graph = new Map<ProvenanceRecord, GraphInfo>();
  const opened = new Set(branchMarker.values());
  let lane = 0;
  for (const record of records) {
    if (branchMarker.has(record)) lane += 1;
    const info: GraphInfo = { lane, laneCount: 1, lines: [] };
    // A marker whose branch already opened draws the curve, not the dashed still-to-come stub.
    if (!record.isDocument && record.action === 'invalidated' && record.what && !record.consumed
      && !opened.has(record)) {
      info.pendingBranch = true;
    }
    graph.set(record, info);
  }
  // Each lane's line spans its branch's marker row (0 for main) through its last own row.
  const laneCount = lane + 1;
  const start = new Array<number>(laneCount).fill(0);
  const end = new Array<number>(laneCount).fill(0);
  records.forEach((record, i) => { end[graph.get(record)!.lane] = i; });
  for (const [stamp, marker] of branchMarker) {
    const opened = graph.get(stamp)!.lane;
    graph.get(marker)!.opens = opened;
    start[opened] = records.indexOf(marker);
  }
  records.forEach((record, i) => {
    const info = graph.get(record)!;
    info.laneCount = laneCount;
    for (let l = 0; l < laneCount; l += 1) {
      // The opening row draws the curve instead of a line; past its last row a lane has ended.
      if (i < start[l] || i > end[l] || (l > 0 && i === start[l])) continue;
      info.lines.push({
        lane: l,
        fromDot: l === 0 && i === 0,
        // The row after a lane's opening: its line starts where the branch curve lands, not at the top.
        fromCurve: l > 0 && i === start[l] + 1,
        toDot: i === end[l],
      });
    }
  });
  return graph;
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

// Compact UTC render for mixed-offset timestamps
export function shortWhen(when?: string): string | undefined {
  const parsed = when ? Date.parse(when) : NaN;
  if (Number.isNaN(parsed)) return when || undefined;
  return new Date(parsed).toISOString().slice(0, 19).replace('T', ' ');
}
