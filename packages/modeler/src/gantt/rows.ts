import { parseChecklistLines } from '@core/document';
import type { Element, StudyModel } from '@core/model/index';
import { resolvePlaceholdersIn } from '@core/model/state';
import { isExpandable } from '@core/document/outline';
import type { ElementRecord, Font } from '@canvas/index.ts';
import type { Editor } from '@modeler/editor/port';
import { DEFAULT_STROKE } from '@modeler/shape/colors';

type TimingAttrs = {
  onset?: string;
  duration?: string;
  progress?: string;
};

export type Row = TimingAttrs & {
  id: string;
  label: string;
  type: string;
  /** The element's own colours, when the diagram gave it any: the bar wears them. */
  fill?: string;
  stroke?: string;
  /** The caption's own style, when the diagram gave it one: the row's label wears it. */
  font?: Font;
  /** The caption sits outside the shape (an event, a gateway): the diagram sets it smaller and lighter. */
  external?: boolean;
  /** Ids of the nearest scheduled predecessors along sequence and message flows: what this row's bar waits on. */
  after: string[];
  /** The row of the sub-process, lane or pool this element sits in: this row is indented under it and hides when it folds. */
  parent?: string;
  /** A container with rows inside it: what it states none of (onset, duration, progress) is summarized from them. */
  group?: boolean;
  /** Best-effort parse of `onset` as minutes-since-epoch-or-T0. */
  onsetMin?: number;
  durationMin?: number;
  progressPct?: number;
  /** The figure the bar shows when it has room: `60%`, or `3/5` from a checklist. */
  progressText?: string;
};

const ATTR_NAMES: (keyof TimingAttrs)[] = ['onset', 'duration', 'progress'];

/** The container an element folds under: its nearest sub-process, else the lane or pool it sits in. */
function groupOf(record: ElementRecord, byId: ReadonlyMap<string, ElementRecord>): ElementRecord | undefined {
  let lane: ElementRecord | undefined;
  for (let parent = byId.get(record.parent ?? ''); parent; parent = byId.get(parent.parent ?? '')) {
    if (isExpandable(parent.type)) return parent;
    if (!lane && (parent.type === 'bpmn:Lane' || parent.type === 'bpmn:Participant')) lane = parent;
  }
  return lane;
}

function readTimingAttrs(model: StudyModel, element: Element): TimingAttrs {
  const out: TimingAttrs = {};
  for (const k of ATTR_NAMES) {
    const value = model.attributeOrDefault(element, k);
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

/** The progress a checklist implies when the element states none: ticked task items over all task items. */
function checklistProgress(model: StudyModel, element: Element): { pct: number; label: string; text: string } | undefined {
  const text = model.attributeOrDefault(element, 'checklist');
  if (typeof text !== 'string') return undefined;
  let total = 0;
  let checked = 0;
  for (const line of parseChecklistLines(text)) {
    if (line.kind !== 'task') continue;
    total += 1;
    if (line.checked) checked += 1;
  }
  return total > 0 ? { pct: (100 * checked) / total, label: `${checked} of ${total} items`, text: `${checked}/${total}` } : undefined;
}

/**
 * The row for `record`, whose element `model` holds, or null when it schedules nothing; `always` gives a container
 * one for the rows inside it. `external`: its caption sits beside it.
 */
function buildGanttRow(record: ElementRecord, model: StudyModel, anchor: number, external: boolean, always = false): Row | null {
  const element = model.get(record.id) ?? { type: record.type, id: record.id };
  const attrs = readTimingAttrs(model, element);
  if (!always && !ATTR_NAMES.some((k) => attrs[k] !== undefined)) return null;
  const checklist = attrs.progress ? undefined : checklistProgress(model, element);
  const progressPct = attrs.progress ? parseProgressPct(attrs.progress) : checklist?.pct;
  return {
    id: record.id,
    // A view, like the canvas: `{reached}` in a name shows the last run's value.
    label: resolvePlaceholdersIn(model, (typeof element.name === 'string' && element.name) || record.id || '(unnamed)', record.id),
    type: record.type,
    fill: record.fill,
    stroke: record.stroke,
    font: record.font,
    external,
    after: [],
    ...attrs,
    onsetMin: attrs.onset ? parseOnsetMin(attrs.onset, anchor) : undefined,
    durationMin: attrs.duration ? parseDurationMin(attrs.duration) : undefined,
    progress: attrs.progress ?? checklist?.label,
    progressPct,
    progressText: checklist?.text ?? (progressPct === undefined ? undefined : `${Math.round(progressPct)}%`),
  };
}

/** What a row waits on: the step before it, or the pool or step whose message starts it. */
const WAITS_ON = new Set(['bpmn:SequenceFlow', 'bpmn:MessageFlow']);

/** The scheduled elements upstream along those flows, looking through unscheduled ones (a gateway, an event). */
function predecessorsOf(record: ElementRecord, scheduled: Set<string>, byId: ReadonlyMap<string, ElementRecord>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const stack: ElementRecord[] = [record];
  while (stack.length > 0) {
    for (const flowId of stack.pop()!.incoming ?? []) {
      const flow = byId.get(flowId);
      const source = byId.get(flow?.source ?? '');
      if (!flow || !WAITS_ON.has(flow.type) || !source || seen.has(source.id)) continue;
      seen.add(source.id);
      if (scheduled.has(source.id)) found.push(source.id);
      else stack.push(source);
    }
  }
  return found;
}

/** A group's onset, span and progress from its children's, for what it does not state itself. */
function summarize(group: Row, children: Row[]): void {
  const onsets = children.map((r) => r.onsetMin).filter((v): v is number => v !== undefined);
  const ends = children.map((r) => (r.onsetMin !== undefined ? r.onsetMin + (r.durationMin ?? 0) : undefined)).filter((v): v is number => v !== undefined);
  if (group.onsetMin === undefined && onsets.length > 0) group.onsetMin = Math.min(...onsets);
  if (group.durationMin === undefined && group.onsetMin !== undefined && ends.length > 0) group.durationMin = Math.max(...ends) - group.onsetMin;
  const pcts = children.map((r) => r.progressPct).filter((v): v is number => v !== undefined);
  if (group.progressPct === undefined && pcts.length > 0) {
    // ponytail: the plain mean over the children; weight by duration if a long step should count for more.
    group.progressPct = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    group.progress = `${Math.round(group.progressPct)}% over ${children.length} items`;
    group.progressText = `${Math.round(group.progressPct)}%`;
  }
}

/**
 * One row per element carrying a timing attribute, and one per container (sub-process, lane, pool) holding
 * any, in tree order: a container's rows follow it. Onsets are relative to a single shared anchor.
 */
export function collectGanttRows(modeler: Editor): Row[] {
  const { study } = modeler;
  const records = study.list();
  const { model } = study;
  const byId = new Map(records.map((record) => [record.id, record]));
  const captioned = new Set(study.list({ kind: 'label' }).map((label) => label.owner));
  const rows = new Map<string, Row>();
  const anchor = Date.now();
  const add = (record: ElementRecord, always: boolean): Row | null => {
    const row = rows.get(record.id)
      ?? buildGanttRow(record, model, anchor, captioned.has(record.id), always);
    if (!row) return null;
    // The enclosing container (and its own) is a row too, so this one has a parent to fold under.
    const container = groupOf(record, byId);
    const parent = container && (rows.get(container.id) ?? add(container, true));
    if (parent) row.parent = parent.id;
    rows.set(row.id, row);
    return row;
  };
  records.forEach((record) => add(record, false));
  for (const row of rows.values()) row.after = predecessorsOf(byId.get(row.id)!, new Set(rows.keys()), byId);

  const childrenOf = new Map<string | undefined, Row[]>();
  for (const row of rows.values()) childrenOf.set(row.parent, [...(childrenOf.get(row.parent) ?? []), row]);
  // Depth first, children summarized before their parent reads them.
  const ordered: Row[] = [];
  const walk = (parent: string | undefined) => {
    for (const row of childrenOf.get(parent) ?? []) {
      ordered.push(row);
      const children = childrenOf.get(row.id);
      if (children) {
        row.group = true;
        walk(row.id);
        summarize(row, children);
      }
    }
  };
  walk(undefined);
  return ordered;
}

const TICK_STEPS_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080];

/** Tick positions (minutes) for a time axis from `min` to `max`: the smallest step giving at most `maxTicks` ticks. */
export function axisTicks(min: number, max: number, maxTicks = 8): number[] {
  const range = Math.max(1, max - min);
  let step = TICK_STEPS_MIN.find((s) => range / s <= maxTicks) ?? TICK_STEPS_MIN[TICK_STEPS_MIN.length - 1];
  // Past the table (a study of months), whole weeks doubled until they fit.
  while (range / step > maxTicks) step *= 2;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(t);
  return ticks;
}

/** A tick's label: minutes since T0, in the largest unit that divides it. */
export function tickLabel(min: number): string {
  if (min === 0) return 'T0';
  const sign = min < 0 ? '-' : '+';
  const abs = Math.abs(min);
  if (abs % 10080 === 0) return `${sign}${abs / 10080} w`;
  if (abs % 1440 === 0) return `${sign}${abs / 1440} d`;
  if (abs % 60 === 0) return `${sign}${abs / 60} h`;
  return `${sign}${abs} min`;
}

export const ROW_H = 20;
export const ROW_PAD = 12;
export const PITCH = ROW_H + ROW_PAD;
/** An open group's bar is slimmer: its ears drop to the row's full height over the rows it spans. */
export const OPEN_H = ROW_H - 6;
const AXIS_H = 22;
/** How far an arrow steps out of the bar it leaves before it can turn back. */
const STUB = 8;

export type Bar = { x: number; y: number; w: number; stroke: string };

/** An orthogonal polyline through `pts`, each corner a quarter-curve shrunk to fit a short leg. */
function roundedPolyline(pts: [number, number][]): string {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const r = Math.min(8, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
    const ax = cx - Math.sign(cx - px) * r;
    const ay = cy - Math.sign(cy - py) * r;
    const bx = cx + Math.sign(nx - cx) * r;
    const by = cy + Math.sign(ny - cy) * r;
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }
  return `${d} L ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
}

/**
 * From the end of the bar waited on, across, then down into the top of the waiting bar (up into its bottom
 * when it sits above): near its left end, or further right where the leaving bar ends over it. Only when
 * the waiting bar ends before that does the arrow turn back, and never over its bar: it steps out, drops to
 * the gap just before the waiting row, comes back there, and turns in.
 */
export function dependencyPath(from: Bar, to: Bar): string {
  const x0 = from.x + from.w;
  const y0 = from.y + ROW_H / 2;
  const down = to.y > from.y;
  const y1 = down ? to.y : to.y + ROW_H;
  // The landing keeps off the waiting bar's rounded ends, as far as a narrow bar allows.
  const inset = Math.min(6, to.w / 2);
  const x1 = Math.min(Math.max(to.x + inset, x0), to.x + to.w - inset);
  // ponytail: the drop at x1 crosses whatever bars lie between the two rows; route around them if it ever matters.
  if (x0 <= to.x + to.w) return roundedPolyline([[x0, y0], [x1, y0], [x1, y1]]);
  const yGap = down ? to.y - ROW_PAD / 2 : to.y + ROW_H + ROW_PAD / 2;
  return roundedPolyline([[x0, y0], [x0 + STUB, y0], [x0 + STUB, yGap], [to.x + inset, yGap], [to.x + inset, y1]]);
}

/** Each row's groups, outermost first. */
export function ancestorsOf(rows: readonly Row[]): Map<string, string[]> {
  const of = new Map<string, string[]>();
  for (const r of rows) of.set(r.id, r.parent ? [...of.get(r.parent) ?? [], r.parent] : []);
  return of;
}

export type GanttLayout = {
  /** The rows drawn: none under a folded group. */
  visible: Row[];
  /** The earliest onset and the latest end, in minutes; none when no row has an onset, and bars then start at the axis. */
  scale?: { min: number; max: number };
  /** Where a minute on the scale falls, from the axis's start. */
  at: (min: number) => number;
  bars: Map<string, Bar>;
  axisY: number;
  height: number;
  /** An open group's column: its bar's span, drawn faintly down over the rows inside it. */
  bands: { id: string; x: number; y: number; w: number; h: number; stroke: string }[];
  /** One arrow per pair of drawn bars: a row under a folded group hands its arrows to the outermost folded group above it. */
  edges: { key: string; from: string; to: string; a: Bar; b: Bar }[];
};

/**
 * The chart, one SVG for every pool and lane so a dependency can run from a bar in one to a bar in another, and one
 * axis under them all: the rows `collapsed` leaves drawn, a bar each on one scale after a label column `labelW` wide,
 * across an axis `chartW` wide.
 */
export function layoutGantt(rows: readonly Row[], ancestors: ReadonlyMap<string, string[]>, collapsed: ReadonlySet<string>, labelW: number, chartW: number): GanttLayout {
  const visible = rows.filter((r) => !ancestors.get(r.id)!.some((id) => collapsed.has(id)));
  const onsets = rows.map((r) => r.onsetMin).filter((v): v is number => v !== undefined);
  const ends = rows.map((r) => (r.onsetMin !== undefined ? r.onsetMin + (r.durationMin ?? 0) : undefined)).filter((v): v is number => v !== undefined);
  const scale = onsets.length > 0 ? { min: Math.min(...onsets), max: Math.max(...ends, ...onsets) } : undefined;
  const range = scale ? Math.max(1, scale.max - scale.min) : 1;
  const at = (min: number) => ((min - (scale?.min ?? 0)) / range) * chartW;

  const bars = new Map<string, Bar>();
  let y = 4;
  for (const r of visible) {
    const x = scale && r.onsetMin !== undefined ? labelW + at(r.onsetMin) : labelW;
    const w = scale && r.onsetMin !== undefined && r.durationMin !== undefined
      ? Math.max(2, at(r.onsetMin + r.durationMin) - at(r.onsetMin))
      : (r.durationMin !== undefined ? 24 : 6);
    bars.set(r.id, { x, y, w, stroke: r.stroke ?? DEFAULT_STROKE });
    y += PITCH;
  }
  const axisY = y + 2;
  const height = axisY + (scale ? AXIS_H : 0) + 4;

  const bands = visible.filter((g) => g.group && !collapsed.has(g.id)).map((g) => {
    const bar = bars.get(g.id)!;
    const bottom = Math.max(...visible.filter((r) => ancestors.get(r.id)!.includes(g.id)).map((r) => bars.get(r.id)!.y + ROW_H));
    return { id: g.id, x: bar.x, w: bar.w, y: bar.y + OPEN_H, h: bottom - bar.y - OPEN_H, stroke: bar.stroke };
  });

  const shown = (id: string) => ancestors.get(id)!.find((g) => collapsed.has(g)) ?? id;
  const edges = [...new Map(rows.flatMap((r) => r.after.flatMap((after) => {
    const from = shown(after);
    const to = shown(r.id);
    const a = bars.get(from);
    const b = bars.get(to);
    return a && b && from !== to ? [[`${from}->${to}`, { key: `${from}->${to}`, from, to, a, b }] as const] : [];
  }))).values()];

  return { visible, scale, at, bars, axisY, height, bands, edges };
}
