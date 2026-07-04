import { StudyflowElement } from '@/core/extensions';

export type TimingAttrs = {
  onset?: string;
  duration?: string;
  progress?: string;
};

export type Row = TimingAttrs & {
  id: string;
  label: string;
  type: string;
  /** Containing pool/lane label, derived from the BPMN parent chain. */
  swimlane: string;
  /** Best-effort parse of `onset` as minutes-since-epoch-or-T0. */
  onsetMin?: number;
  /** Best-effort parse of `duration` in minutes. */
  durationMin?: number;
  /** Best-effort parse of `progress` as 0-100. */
  progressPct?: number;
};

export const ATTR_NAMES: (keyof TimingAttrs)[] = ['onset', 'duration', 'progress'];

/** Find the swimlane label for an element: its containing Lane, else Pool. */
export function findSwimlane(el: any): string {
  // bpmn-js does not reparent flow nodes under their lane — lane membership is
  // a semantic back-reference (`businessObject.lanes`), while `el.parent` is the
  // enclosing pool. Prefer the lane so the Gantt groups by lane, not by pool.
  const bo = el?.businessObject;
  const lanes = bo?.get?.('lanes') ?? bo?.lanes;
  if (Array.isArray(lanes) && lanes.length > 0) {
    const lane = lanes[0];
    return lane?.name || lane?.id || '(Lane)';
  }
  let p = el?.parent;
  while (p) {
    const pbo = p.businessObject;
    const type = pbo?.$type;
    if (type === 'bpmn:Lane' || type === 'bpmn:Participant') {
      return pbo.name || pbo.id || `(${type.split(':')[1]})`;
    }
    p = p.parent;
  }
  return 'Unassigned';
}

export function readTimingAttrs(bo: any): TimingAttrs {
  const out: TimingAttrs = {};
  const ext = StudyflowElement.fromBusinessObject(bo).extension;
  for (const k of ATTR_NAMES) {
    const direct = bo?.[k];
    const fromExt = ext?.get?.(k) ?? ext?.[k];
    const v = (typeof direct === 'string' && direct.trim() ? direct : undefined)
            ?? (typeof fromExt === 'string' && fromExt.trim() ? fromExt : undefined);
    if (v) out[k] = v.trim();
  }
  return out;
}

/** Best-effort parse of a duration string into minutes. */
export function parseDurationMin(raw: string): number | undefined {
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;

  // ISO 8601: PT1H30M, PT45M, P1D
  const iso = s.match(/^p(?:(\d+(?:\.\d+)?)w)?(?:(\d+(?:\.\d+)?)d)?(?:t(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?)?$/i);
  if (iso && iso[0] !== 'p' && iso[0] !== 'pt') {
    let mins = 0;
    if (iso[1]) mins += parseFloat(iso[1]) * 7 * 24 * 60;
    if (iso[2]) mins += parseFloat(iso[2]) * 24 * 60;
    if (iso[3]) mins += parseFloat(iso[3]) * 60;
    if (iso[4]) mins += parseFloat(iso[4]);
    if (iso[5]) mins += parseFloat(iso[5]) / 60;
    if (mins > 0) return mins;
  }

  // Plain shorthand: "1h30min", "45min", "2 days", "3 weeks".
  let mins = 0;
  const w = s.match(/(\d+(?:\.\d+)?)\s*w(?:k|eek)?s?/);
  if (w) mins += parseFloat(w[1]) * 7 * 24 * 60;
  const day = s.match(/(\d+(?:\.\d+)?)\s*d(?:ay)?s?/);
  if (day) mins += parseFloat(day[1]) * 24 * 60;
  const h = s.match(/(\d+(?:\.\d+)?)\s*h(?:our|r)?s?/);
  if (h) mins += parseFloat(h[1]) * 60;
  const m = s.match(/(\d+(?:\.\d+)?)\s*m(?:in)?/);
  if (m) mins += parseFloat(m[1]);
  return mins > 0 ? mins : undefined;
}

/** Best-effort parse of an onset string: ISO date, T+offset, or fallback undefined. */
export function parseOnsetMin(raw: string, anchor: number): number | undefined {
  const s = raw.trim();
  if (!s) return undefined;

  // ISO date / datetime
  const isoDate = Date.parse(s);
  if (!Number.isNaN(isoDate)) return (isoDate - anchor) / 60_000;

  // T0, T0+30min, T+1h
  const rel = s.toLowerCase().match(/^t[\d.]*\s*[+-]?\s*(.+)$/);
  if (rel) {
    const offset = parseDurationMin(rel[1]);
    if (offset !== undefined) return offset;
  }

  // Bare duration as an onset (treat as offset from anchor).
  return parseDurationMin(s);
}

export function parseProgressPct(raw: string): number | undefined {
  const s = raw.trim().toLowerCase();
  if (s === 'done' || s === 'complete' || s === 'completed') return 100;
  if (s === 'blocked' || s === 'todo' || s === 'pending') return 0;
  if (s === 'in-progress' || s === 'in progress' || s === 'wip') return 50;
  const num = s.match(/^(\d+(?:\.\d+)?)\s*%?$/);
  if (num) return Math.min(100, Math.max(0, parseFloat(num[1])));
  return undefined;
}

/** Build a Gantt row from a diagram element, or `null` when it carries no
 *  timing attributes. `anchor` is the epoch reference for onset parsing. */
export function buildGanttRow(el: any, anchor: number): Row | null {
  const bo = el.businessObject;
  if (!bo) return null;
  const attrs = readTimingAttrs(bo);
  if (!ATTR_NAMES.some((k) => attrs[k] !== undefined)) return null;
  return {
    id: el.id || bo.id || '(unnamed)',
    label: bo.name || bo.id || '(unnamed)',
    type: bo.$type || el.type || 'Element',
    swimlane: findSwimlane(el),
    ...attrs,
    onsetMin: attrs.onset ? parseOnsetMin(attrs.onset, anchor) : undefined,
    durationMin: attrs.duration ? parseDurationMin(attrs.duration) : undefined,
    progressPct: attrs.progress ? parseProgressPct(attrs.progress) : undefined,
  };
}

export function groupBy<T>(rows: T[], key: (r: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return Array.from(map);
}
