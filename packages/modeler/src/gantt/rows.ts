import { StudyflowElement } from '@core/element';
import type { Editor } from '@modeler/editor/port';

type TimingAttrs = {
  onset?: string;
  duration?: string;
  progress?: string;
};

export type Row = TimingAttrs & {
  id: string;
  label: string;
  type: string;
  swimlane: string;
  /** Best-effort parse of `onset` as minutes-since-epoch-or-T0. */
  onsetMin?: number;
  durationMin?: number;
  progressPct?: number;
};

const ATTR_NAMES: (keyof TimingAttrs)[] = ['onset', 'duration', 'progress'];

function findSwimlane(el: any): string {
  // bpmn-js does not reparent flow nodes under their lane: membership is `businessObject.lanes`, `el.parent` the pool.
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

function readTimingAttrs(bo: any): TimingAttrs {
  const out: TimingAttrs = {};
  const handle = StudyflowElement.fromBusinessObject(bo);
  for (const k of ATTR_NAMES) {
    const value = handle.getAttribute(k);
    if (typeof value === 'string' && value.trim()) out[k] = value.trim();
  }
  return out;
}

const UNIT_MINUTES: [RegExp, number][] = [
  [/(\d+(?:\.\d+)?)\s*(?:w|wk|wks|week|weeks)\b/, 7 * 24 * 60],
  [/(\d+(?:\.\d+)?)\s*(?:d|day|days)\b/, 24 * 60],
  [/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/, 60],
  [/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/, 1],
  [/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/, 1 / 60],
];

function parseDurationMin(raw: string): number | undefined {
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;

  if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);

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

  let mins = 0;
  let matched = false;
  for (const [pattern, factor] of UNIT_MINUTES) {
    const hit = s.match(pattern);
    if (hit) {
      mins += parseFloat(hit[1]) * factor;
      matched = true;
    }
  }
  return matched ? mins : undefined;
}

const DATE_LIKE = /^\d{4}-\d{2}(?:-\d{2})?(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/;

function parseOnsetMin(raw: string, anchor: number): number | undefined {
  const s = raw.trim();
  if (!s) return undefined;

  // T0, T0+30min, T+1h, T0-15min
  const rel = s.toLowerCase().match(/^t[\d.]*\s*([+-])?\s*(.+)$/);
  if (rel) {
    const offset = parseDurationMin(rel[2]);
    if (offset !== undefined) return rel[1] === '-' ? -offset : offset;
  }

  if (DATE_LIKE.test(s)) {
    const parsed = Date.parse(s);
    if (!Number.isNaN(parsed)) return (parsed - anchor) / 60_000;
  }

  return parseDurationMin(s);
}

function parseProgressPct(raw: string): number | undefined {
  const s = raw.trim().toLowerCase();
  if (s === 'done' || s === 'complete' || s === 'completed') return 100;
  if (s === 'blocked' || s === 'todo' || s === 'pending') return 0;
  if (s === 'in-progress' || s === 'in progress' || s === 'wip') return 50;
  const num = s.match(/^(\d+(?:\.\d+)?)\s*%?$/);
  if (num) return Math.min(100, Math.max(0, parseFloat(num[1])));
  return undefined;
}

function buildGanttRow(el: any, anchor: number): Row | null {
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

/** One row per element carrying a timing attribute; onsets are relative to a single shared anchor. */
export function collectGanttRows(modeler: Editor): Row[] {
  if (!modeler) return [];
  const rows: Row[] = [];
  const anchor = Date.now();
  modeler.canvas.all().forEach((el: any) => {
    if (el.kind === 'label') return;
    const row = buildGanttRow(el, anchor);
    if (row) rows.push(row);
  });
  return rows;
}

export function groupBySwimlane(rows: Row[]): [string, Row[]][] {
  const map = new Map<string, Row[]>();
  for (const row of rows) {
    if (!map.has(row.swimlane)) map.set(row.swimlane, []);
    map.get(row.swimlane)!.push(row);
  }
  return Array.from(map);
}
