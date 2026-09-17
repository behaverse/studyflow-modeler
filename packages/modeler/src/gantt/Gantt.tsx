import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { useModeler } from '@modeler/app/useModeler';
import { ROW_H, ROW_PAD, axisTicks, collectGanttRows, dependencyPath, groupBySwimlane, tickLabel } from '@modeler/gantt/rows';
import type { Bar } from '@modeler/gantt/rows';
import { dialog as d } from '@modeler/ui/styles';
import { DialogHelp } from '@modeler/ui/DialogHelp';
import { ICONS } from '@modeler/icons';
import { DEFAULT_FILL, DEFAULT_STROKE } from '@modeler/shape/colors';

type Props = { isOpen: boolean; onClose: () => void };

const MIN_CHART_W = 320;
/** Room one tick label needs, so the axis picks a step whose labels never overlap. */
const TICK_W = 56;
const PITCH = ROW_H + ROW_PAD;
/** The label column hugs the widest label, up to this; a wider one wraps. */
const LABEL_MAX = 200;
const LABEL_PAD = 12;
/** How far a row inside a group sits in from its group's label. */
const INDENT = 14;
const AXIS_H = 22;
const HEADING_H = 24;
const GROUP_GAP = 20;

/** The attributes of a figure centred on a point. */
function figureAt(x: number, y: number) {
  return { x, y, textAnchor: 'middle', dominantBaseline: 'central', fontSize: 10, pointerEvents: 'none' } as const;
}

let measurer: CanvasRenderingContext2D | null | undefined;
/** The rendered width of `text` in the labels' font, off screen. */
function textWidth(text: string, font: string): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * 6;
  measurer.font = font;
  return measurer.measureText(text).width;
}

export function GanttDialog({ isOpen, onClose }: Props) {
  const modeler = useModeler();
  const rows = useMemo(() => (isOpen ? collectGanttRows(modeler) : []), [isOpen, modeler]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  // A row's groups, outermost first; a row under a folded one is not drawn.
  const ancestors = useMemo(() => {
    const of = new Map<string, string[]>();
    for (const r of rows) of.set(r.id, r.parent ? [...of.get(r.parent) ?? [], r.parent] : []);
    return of;
  }, [rows]);
  const visible = useMemo(
    () => rows.filter((r) => !ancestors.get(r.id)!.some((id) => collapsed.has(id))),
    [rows, ancestors, collapsed],
  );

  // The chart fills the dialog: re-measured when the body resizes, which is what maximizing does to it.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyW, setBodyW] = useState(776);
  const hasRows = rows.length > 0;
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setBodyW(Math.floor(entry.contentRect.width)));
    observer.observe(body);
    return () => observer.disconnect();
  }, [hasRows]);
  const fontFamily = useMemo(() => getComputedStyle(document.body).fontFamily, []);
  const labelW = useMemo(() => {
    const widest = Math.max(0, ...rows.map((r) => textWidth(r.label, `12px ${fontFamily}`) + INDENT * (ancestors.get(r.id)!.length + (r.group ? 1 : 0))));
    return Math.min(LABEL_MAX, Math.ceil(widest) + LABEL_PAD);
  }, [rows, ancestors, fontFamily]);
  // Half a tick label past the axis end, so the last label is whole.
  const chartW = Math.max(MIN_CHART_W, bodyW - labelW - TICK_W / 2);

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

  const groups = useMemo(() => groupBySwimlane(visible), [visible]);

  const range = Math.max(1, maxOnset - minOnset);
  const xForMin = (min: number) => ((min - minOnset) / range) * chartW;
  const ticks = hasScale ? axisTicks(minOnset, maxOnset, Math.max(2, Math.floor(chartW / TICK_W))) : [];

  // One SVG for every lane, so a dependency can run from a bar in one lane to a bar in another,
  // and one axis under them all: every lane is on the same scale.
  const bars = new Map<string, Bar>();
  const headings: { label: string; y: number }[] = [];
  let y = 4;
  for (const [label, groupRows] of groups) {
    // The heading names the lane; a study without lanes has one group and no heading to give it.
    if (groups.length > 1 || label !== 'Unassigned') {
      y += HEADING_H;
      headings.push({ label, y: y - 8 });
    }
    for (const r of groupRows) {
      const x = hasScale && r.onsetMin !== undefined ? labelW + xForMin(r.onsetMin) : labelW;
      const w = hasScale && r.onsetMin !== undefined && r.durationMin !== undefined
        ? Math.max(2, xForMin(r.onsetMin + r.durationMin) - xForMin(r.onsetMin))
        : (r.durationMin !== undefined ? 24 : 6);
      bars.set(r.id, { x, y, w, stroke: r.stroke ?? DEFAULT_STROKE });
      y += PITCH;
    }
    y += GROUP_GAP;
  }
  const axisY = y - GROUP_GAP + 2;
  const height = axisY + (hasScale ? AXIS_H : 0) + 4;
  // An open group's column: its bar's span, drawn faintly down over the rows inside it.
  const bands = visible.filter((g) => g.group && !collapsed.has(g.id)).map((g) => {
    const bar = bars.get(g.id)!;
    const bottom = Math.max(...visible.filter((r) => ancestors.get(r.id)!.includes(g.id)).map((r) => bars.get(r.id)!.y + ROW_H));
    return { id: g.id, x: bar.x, w: bar.w, y: bar.y + ROW_H, h: bottom - bar.y - ROW_H, stroke: bar.stroke };
  });
  const labelOf = new Map(rows.map((r) => [r.id, r.label]));
  const edges = visible.flatMap((r) => r.after.flatMap((from) => {
    const a = bars.get(from);
    const b = bars.get(r.id);
    return a && b ? [{ key: `${from}->${r.id}`, from, to: r.id, a, b }] : [];
  }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Gantt View"
      size="lg"
      help={<DialogHelp>
                Every element carrying an <code>onset</code>, <code>duration</code>, or <code>progress</code>, laid out on one schedule and grouped by the container.
                An arrow joins two scheduled elements a sequence flow connects, through any unscheduled ones between them.
                A sub-process holding scheduled elements is a group: fold it to a bar whose onset, duration and progress are summarized from theirs.
              </DialogHelp>}
    >
            {!hasRows ? (
              <p className="text-sm text-stone-500 italic">
                No schedule yet. Give an element an onset or duration in the inspector.
              </p>
            ) : (
              <div ref={bodyRef} className={`${d.panelBody} pr-2`}>
                <div className="overflow-x-auto">
                  <svg width={labelW + chartW + TICK_W / 2} height={height} role="img" aria-label="Gantt chart">
                    <defs>
                      {/* The canvas's directed-association head, in the stroke of the path that carries it, small enough to sit in the gap between two rows. */}
                      <marker id="gantt-arrow" markerWidth={7} markerHeight={7} refX={6} refY={3.5} orient="auto" markerUnits="userSpaceOnUse">
                        <path d="M1,1 L6,3.5 L1,6" fill="none" stroke="context-stroke" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
                      </marker>
                    </defs>
                    {headings.map((h) => (
                      <text key={h.label} x={0} y={h.y} className="text-xs font-semibold uppercase tracking-wide fill-stone-500">
                        {h.label}
                      </text>
                    ))}
                    {hasScale && (
                      <g transform={`translate(${labelW}, ${axisY})`}>
                        <line x1={0} x2={chartW} y1={0} y2={0} stroke={DEFAULT_STROKE} strokeWidth={1} />
                        {ticks.map((t) => (
                          <g key={t} transform={`translate(${xForMin(t)}, 0)`}>
                            <line y1={0} y2={4} stroke={DEFAULT_STROKE} strokeWidth={1} />
                            <text y={15} textAnchor="middle" fontSize={10} fill="#78716c">{tickLabel(t)}</text>
                          </g>
                        ))}
                      </g>
                    )}
                    {bands.map((b) => (
                      <rect key={b.id} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.stroke} fillOpacity={0.08} pointerEvents="none" />
                    ))}
                    {/* An arrow in its source's colour but lighter, so it reads as that bar's continuation without competing with it. */}
                    {edges.map((e) => (
                      <path key={e.key} d={dependencyPath(e.a, e.b)} fill="none" stroke={e.a.stroke} strokeWidth={1.5} opacity={0.55} markerEnd="url(#gantt-arrow)">
                        <title>{labelOf.get(e.to)} after {labelOf.get(e.from)}</title>
                      </path>
                    ))}
                    {visible.map((r) => {
                      const { x, y, w } = bars.get(r.id)!;
                      const depth = ancestors.get(r.id)!.length;
                      const progressW = r.progressPct !== undefined ? (w * r.progressPct) / 100 : 0;
                      // The bar wears the element's style: its fill, its stroke as the border and as the progress.
                      const fill = r.fill ?? DEFAULT_FILL;
                      const stroke = r.stroke ?? DEFAULT_STROKE;
                      return (
                        <g key={r.id}>
                          {/* HTML, so a long name wraps onto a second line (the row's full pitch) and ends in an ellipsis past that. */}
                          <foreignObject x={0} y={y - ROW_PAD / 2} width={labelW - 8} height={PITCH}>
                            <div title={r.label} style={{ paddingLeft: depth * INDENT }} className={`flex h-full items-center text-xs leading-4 text-[#3f3f3f] ${r.group ? 'font-semibold' : ''}`}>
                              {r.group && (
                                <button type="button" onClick={() => toggle(r.id)} className={`${d.titleAction} shrink-0`} aria-expanded={!collapsed.has(r.id)} aria-label={collapsed.has(r.id) ? 'Expand' : 'Collapse'}>
                                  <i className={`${ICONS.chevronRight} size-3.5 block transition-transform ${collapsed.has(r.id) ? '' : 'rotate-90'}`}></i>
                                </button>
                              )}
                              <span className="line-clamp-2">{r.label}</span>
                            </div>
                          </foreignObject>
                          <rect x={x} y={y} width={w} height={ROW_H} fill={fill} stroke={stroke} strokeWidth={1.5} rx={3} />
                          {progressW > 0 && (
                            <rect x={x} y={y} width={progressW} height={ROW_H} fill={stroke} rx={3} />
                          )}
                          {/* The figure, when the bar has room for it: in the bar's ink, and in its paper where it crosses the filled part. */}
                          {r.progressText && w >= textWidth(r.progressText, `10px ${fontFamily}`) + 8 && (
                            <>
                              <text {...figureAt(x + w / 2, y + ROW_H / 2)} fill={stroke}>{r.progressText}</text>
                              {progressW > 0 && (
                                <>
                                  <clipPath id={`gantt-done-${r.id}`}>
                                    <rect x={x} y={y} width={progressW} height={ROW_H} />
                                  </clipPath>
                                  <text {...figureAt(x + w / 2, y + ROW_H / 2)} fill={fill} clipPath={`url(#gantt-done-${r.id})`}>
                                    {r.progressText}
                                  </text>
                                </>
                              )}
                            </>
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
                </div>
                {!hasScale && (
                  <p className="text-[0.6875rem] text-stone-500 italic">
                    No parseable <code>onset</code> values found; bars are placed at column 0
                    and sized by <code>duration</code> only.
                  </p>
                )}
              </div>
            )}
    </Modal>
  );
}
