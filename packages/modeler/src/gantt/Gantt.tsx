import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { useModeler } from '@modeler/app/useModeler';
import { OPEN_H, PITCH, ROW_H, ROW_PAD, ancestorsOf, axisTicks, collectGanttRows, dependencyPath, layoutGantt, tickLabel } from '@modeler/gantt/rows';
import { dialog as d } from '@modeler/ui/styles';
import { DialogHelp } from '@modeler/ui/DialogHelp';
import { ICONS } from '@modeler/icons';
import { DEFAULT_FILL, DEFAULT_STROKE } from '@modeler/shape/colors';

type Props = { isOpen: boolean; onClose: () => void };

const MIN_CHART_W = 320;
/** Room one tick label needs, so the axis picks a step whose labels never overlap. */
const TICK_W = 56;
/** The label column hugs the widest label, up to this; a wider one wraps. */
const LABEL_MAX = 200;
const LABEL_PAD = 12;
/** How far a row inside a group sits in from its group's label. */
const INDENT = 14;

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
  const ancestors = useMemo(() => ancestorsOf(rows), [rows]);

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

  const { visible, scale, at, bars, axisY, height, bands, edges } = layoutGantt(rows, ancestors, collapsed, labelW, chartW);
  const ticks = scale ? axisTicks(scale.min, scale.max, Math.max(2, Math.floor(chartW / TICK_W))) : [];
  const labelOf = new Map(rows.map((r) => [r.id, r.label]));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Gantt View"
      size="lg"
      help={<DialogHelp>
                Every element carrying an <code>onset</code>, <code>duration</code>, or <code>progress</code>, laid out on one schedule.
                An arrow joins two scheduled elements a sequence or message flow connects, through any unscheduled ones between them.
                A pool, lane or sub-process holding scheduled elements is a group: fold it to a bar whose onset, duration and progress are summarized from theirs.
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
                    {scale && (
                      <g transform={`translate(${labelW}, ${axisY})`}>
                        <line x1={0} x2={chartW} y1={0} y2={0} stroke={DEFAULT_STROKE} strokeWidth={1} />
                        {ticks.map((t) => (
                          <g key={t} transform={`translate(${at(t)}, 0)`}>
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
                      // An open group's bar hangs an ear off each end, over the rows it spans: one outline with a rounded top,
                      // so the progress fills into the ears and the border alone draws the rest. Any other bar is rounded all round.
                      const open = r.group && !collapsed.has(r.id);
                      const h = open ? OPEN_H : ROW_H;
                      const outline = open
                        ? `M ${x} ${y + h + 6} V ${y + 3} q 0 -3 3 -3 H ${x + w - 3} q 3 0 3 3 V ${y + h + 6} L ${x + w - 7} ${y + h} H ${x + 7} Z`
                        : undefined;
                      return (
                        <g key={r.id}>
                          {/* HTML, so a long name wraps onto a second line (the row's full pitch) and ends in an ellipsis past that. */}
                          <foreignObject x={0} y={y - ROW_PAD / 2} width={labelW - 8} height={PITCH}>
                            {/* The caption as the diagram draws it: a shape's inside caption at 12/500, an outside one at 11/400, in the element's own font. */}
                            <div
                              title={r.label}
                              style={{
                                paddingLeft: depth * INDENT,
                                fontSize: r.external ? 11 : 12,
                                fontWeight: r.font?.bold ? 700 : r.external ? 400 : 500,
                                fontStyle: r.font?.italic ? 'italic' : undefined,
                                color: r.font?.color ?? 'var(--sf-ink-text)',
                              }}
                              className="flex h-full items-center leading-4"
                            >
                              <span className="flex items-start">
                                {/* The caret sits on the first line, at the text's own size. */}
                                {r.group && (
                                  <button type="button" onClick={() => toggle(r.id)} className={`${d.titleAction} mr-1.5 flex h-4 shrink-0 items-center`} aria-expanded={!collapsed.has(r.id)} aria-label={collapsed.has(r.id) ? 'Expand' : 'Collapse'}>
                                    <i className={`${ICONS.chevronRight} size-2.5 block transition-transform ${collapsed.has(r.id) ? '' : 'rotate-90'}`}></i>
                                  </button>
                                )}
                                <span className="line-clamp-2">{r.label}</span>
                              </span>
                            </div>
                          </foreignObject>
                          {outline ? (
                            <>
                              <path d={outline} fill={fill} stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
                              <clipPath id={`gantt-bar-${r.id}`}><path d={outline} /></clipPath>
                            </>
                          ) : (
                            <rect x={x} y={y} width={w} height={ROW_H} fill={fill} stroke={stroke} strokeWidth={1.5} rx={3} />
                          )}
                          {progressW > 0 && (
                            <rect x={x} y={y} width={progressW} height={h + (outline ? 6 : 0)} fill={stroke} rx={outline ? 0 : 3} clipPath={outline ? `url(#gantt-bar-${r.id})` : undefined} />
                          )}
                          {/* The figure, when the bar has room for it: in the bar's ink, and in its paper where it crosses the filled part. */}
                          {r.progressText && w >= textWidth(r.progressText, `10px ${fontFamily}`) + 8 && (
                            <>
                              <text {...figureAt(x + w / 2, y + h / 2)} fill={stroke}>{r.progressText}</text>
                              {progressW > 0 && (
                                <>
                                  <clipPath id={`gantt-done-${r.id}`}>
                                    <rect x={x} y={y} width={progressW} height={h} />
                                  </clipPath>
                                  <text {...figureAt(x + w / 2, y + h / 2)} fill={fill} clipPath={`url(#gantt-done-${r.id})`}>
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
                            ].filter(Boolean).join(' • ')}
                          </title>
                        </g>
                      );
                    })}
                  </svg>
                </div>
                {!scale && (
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
