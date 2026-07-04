import { useMemo } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useModeler } from '@/modeler/views/useModeler';
import { buildGanttRow, groupBy, type Row } from '@/modeler/models/dialogs/gantt';
import { dialog as d } from '@/modeler/infra/styles';
import { DialogHelp } from '@/modeler/views/dialogs/DialogHelp';
import { ICONS } from '@/icons';

function collectRows(modeler: any): Row[] {
  if (!modeler) return [];
  const elementRegistry = modeler.get('elementRegistry');
  const rows: Row[] = [];
  const anchor = Date.now();
  elementRegistry.forEach((el: any) => {
    if (el.type === 'label') return;
    const row = buildGanttRow(el, anchor);
    if (row) rows.push(row);
  });
  return rows;
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
                <i className={ICONS.close}></i>
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
