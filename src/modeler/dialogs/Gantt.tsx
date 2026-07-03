import { useMemo } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useModeler } from '../useModeler';
import { getExtensionElement } from '@/lib/core/extensions';
import { dialog as d } from '../styles';
import { DialogHelp } from './DialogHelp';

type TimingAttrs = {
  onset?: string;
  duration?: string;
  progress?: string;
};

type Row = TimingAttrs & {
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

const ATTR_NAMES: (keyof TimingAttrs)[] = ['onset', 'duration', 'progress'];

/** Find the swimlane label for an element: its containing Lane, else Pool. */
function findSwimlane(el: any): string {
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

function readTimingAttrs(bo: any): TimingAttrs {
  const out: TimingAttrs = {};
  const ext = getExtensionElement(bo);
  for (const k of ATTR_NAMES) {
    const direct = bo?.[k];
    const fromExt = ext?.get?.(k) ?? ext?.[k];
    const v = (typeof direct === 'string' && direct.trim() ? direct : undefined)
            ?? (typeof fromExt === 'string' && fromExt.trim() ? fromExt : undefined);
    if (v) out[k] = v.trim();
  }
  return out;
}

function hasAnyTiming(t: TimingAttrs): boolean {
  return ATTR_NAMES.some((k) => t[k] !== undefined);
}

/** Best-effort parse of a duration string into minutes. */
function parseDurationMin(raw: string): number | undefined {
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
function parseOnsetMin(raw: string, anchor: number): number | undefined {
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

function parseProgressPct(raw: string): number | undefined {
  const s = raw.trim().toLowerCase();
  if (s === 'done' || s === 'complete' || s === 'completed') return 100;
  if (s === 'blocked' || s === 'todo' || s === 'pending') return 0;
  if (s === 'in-progress' || s === 'in progress' || s === 'wip') return 50;
  const num = s.match(/^(\d+(?:\.\d+)?)\s*%?$/);
  if (num) return Math.min(100, Math.max(0, parseFloat(num[1])));
  return undefined;
}

function collectRows(modeler: any): Row[] {
  if (!modeler) return [];
  const elementRegistry = modeler.get('elementRegistry');
  const rows: Row[] = [];
  const anchor = Date.now();
  elementRegistry.forEach((el: any) => {
    if (el.type === 'label') return;
    const bo = el.businessObject;
    if (!bo) return;
    const attrs = readTimingAttrs(bo);
    if (!hasAnyTiming(attrs)) return;
    rows.push({
      id: el.id || bo.id || '(unnamed)',
      label: bo.name || bo.id || '(unnamed)',
      type: bo.$type || el.type || 'Element',
      swimlane: findSwimlane(el),
      ...attrs,
      onsetMin: attrs.onset ? parseOnsetMin(attrs.onset, anchor) : undefined,
      durationMin: attrs.duration ? parseDurationMin(attrs.duration) : undefined,
      progressPct: attrs.progress ? parseProgressPct(attrs.progress) : undefined,
    });
  });
  return rows;
}

function groupBy<T>(rows: T[], key: (r: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return Array.from(map);
}

type Props = { isOpen: boolean; onClose: () => void };

const CHART_W = 640;
const ROW_H = 24;
const ROW_PAD = 6;
const LABEL_W = 220;
const PROGRESS_FILL = '#7c6f64';
const BAR_FILL = '#c8b8a9';
const BAR_STROKE = '#7c6f64';

export function GanttDialog({ isOpen, onClose }: Props) {
  const modeler = useModeler();
  const rows = useMemo(() => (isOpen ? collectRows(modeler) : []), [isOpen, modeler]);

  const { minOnset, maxOnset, hasScale } = useMemo(() => {
    const onsets = rows.map((r) => r.onsetMin).filter((v): v is number => v !== undefined);
    const ends = rows.map((r) => {
      if (r.onsetMin !== undefined && r.durationMin !== undefined) return r.onsetMin + r.durationMin;
      if (r.onsetMin !== undefined) return r.onsetMin;
      return undefined;
    }).filter((v): v is number => v !== undefined);
    if (onsets.length === 0) return { minOnset: 0, maxOnset: 0, hasScale: false };
    return {
      minOnset: Math.min(...onsets),
      maxOnset: Math.max(...ends, ...onsets),
      hasScale: true,
    };
  }, [rows]);

  const groups = useMemo(() => groupBy(rows, (r) => r.swimlane), [rows]);

  const range = Math.max(1, maxOnset - minOnset);
  const xForMin = (min: number) => ((min - minOnset) / range) * CHART_W;

  return (
    <Dialog open={isOpen} onClose={onClose} className={d.root}>
      <div className={d.backdrop}>
        <div className={d.centerLayout}>
          <DialogPanel className={`${d.panelLg} ${d.panel}`}>
            <DialogTitle as="h3" className={`${d.title} pb-3 flex items-center gap-1`}>
              <span>Gantt View</span>
              <DialogHelp>
                Activities and BPMN events that carry <code>onset</code>,{' '}
                <code>duration</code>, or <code>progress</code> attributes from the current
                diagram. Bars are positioned by best-effort parsing of the onset/duration
                strings; rows without parseable timing fall back to a label-only row. Rows
                are grouped by the containing pool or lane (or labelled
                <em> Unassigned</em> when no swimlane wraps them).
              </DialogHelp>
              <span className="flex-1" aria-hidden="true" />
              <span className={d.closeButton} onClick={onClose}>
                <i className="iconify bi--x-lg"></i>
              </span>
            </DialogTitle>
            {rows.length === 0 ? (
              <p className="text-sm text-stone-500 italic">
                No elements in this diagram carry temporal attributes yet.
              </p>
            ) : (
              <div className={`${d.panelBody} space-y-5 pr-2`}>
                {groups.map(([groupLabel, groupRows]) => (
                  <section key={groupLabel} className="overflow-x-auto">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500 pb-1">
                      {groupLabel}
                    </h4>
                    <svg
                      width={LABEL_W + CHART_W + 16}
                      height={groupRows.length * (ROW_H + ROW_PAD) + 8}
                      role="img"
                      aria-label={`Gantt chart for ${groupLabel}`}
                    >
                      {groupRows.map((r, i) => {
                        const y = i * (ROW_H + ROW_PAD) + 4;
                        const x = hasScale && r.onsetMin !== undefined ? LABEL_W + xForMin(r.onsetMin) : LABEL_W;
                        const w = hasScale && r.onsetMin !== undefined && r.durationMin !== undefined
                          ? Math.max(2, xForMin(r.onsetMin + r.durationMin) - xForMin(r.onsetMin))
                          : (r.durationMin !== undefined ? 24 : 6);
                        const progressW = r.progressPct !== undefined ? (w * r.progressPct) / 100 : 0;
                        return (
                          <g key={r.id}>
                            <text
                              x={LABEL_W - 8}
                              y={y + ROW_H / 2 + 4}
                              textAnchor="end"
                              fontSize={12}
                              fill="#3f3f3f"
                            >
                              {r.label}
                            </text>
                            <rect
                              x={x}
                              y={y}
                              width={w}
                              height={ROW_H}
                              fill={BAR_FILL}
                              stroke={BAR_STROKE}
                              strokeWidth={1}
                              rx={3}
                            />
                            {progressW > 0 && (
                              <rect
                                x={x}
                                y={y}
                                width={progressW}
                                height={ROW_H}
                                fill={PROGRESS_FILL}
                                rx={3}
                              />
                            )}
                            <title>
                              {[
                                r.onset && `onset: ${r.onset}`,
                                r.duration && `duration: ${r.duration}`,
                                r.progress && `progress: ${r.progress}`,
                                r.swimlane !== 'Unassigned' && `swimlane: ${r.swimlane}`,
                              ].filter(Boolean).join(' • ')}
                            </title>
                          </g>
                        );
                      })}
                    </svg>
                  </section>
                ))}
                {!hasScale && (
                  <p className="text-[11px] text-stone-500 italic">
                    No parseable <code>onset</code> values found; bars are placed at column 0
                    and sized by <code>duration</code> only.
                  </p>
                )}
              </div>
            )}
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
