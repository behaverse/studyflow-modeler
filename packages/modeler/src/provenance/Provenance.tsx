import { useContext, useEffect, useMemo, useReducer, useState } from 'react';
import { ModeContext } from '@modeler/app/contexts';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { getStoredUserEmail } from '@modeler/settings/store';
import {
  assignLanes,
  collectProvenance,
  DETAIL_ICONS,
  displayOrder,
  laneOf,
  type ProvenanceRecord,
  recordDetails,
  shortWhen,
} from '@modeler/provenance/records';
import { chip, dialog as d } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';
import { pressRun } from '@modeler/composer/run';
import { useSelection } from '@modeler/composer/hooks';
import { showElement } from '@modeler/views/hooks';
import { clearViewScope, closeView, useViews } from '@modeler/views/store';
import { drawer as v } from '@modeler/views/styles';

const LANE_W = 12;
const laneX = (lane: number) => lane * LANE_W + 4.5;
// The element-shape icons sit in their own left column, outside the tree, so they align.
const ICON_GUTTER = 22;

/**
 * The provenance, a view in the drawer under the canvas: who changed the study and who ran it, oldest first, as the
 * modeler and the runner stamped it into the file. Invalidating a run record appends a marker, so the next run
 * re-executes that step and what depends on it; the replay plays the timeline on the canvas. The selection's records
 * are marked, a press on a record selects its element, and `p` shows one element's records alone.
 */
export function ProvenanceView() {
  const modeler = useModeler();
  const selection = useSelection(modeler);
  const { scope } = useViews();
  const { openReplay } = useContext(ModeContext);
  const [revision, bumpRevision] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    modeler.events.on('HistoryChanged', bumpRevision);
    return () => modeler.events.off('HistoryChanged', bumpRevision);
  }, [modeler]);

  const [showReused, setShowReused] = useState(true);
  const allRecords = useMemo(
    () => collectProvenance(modeler.study.model),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision` stands in for the document
    [modeler, revision],
  );
  const hasReused = allRecords.some((r) => r.action === 'reused');
  const visible = displayOrder(allRecords.filter((r) =>
    (!scope || r.scopeId === scope) && (showReused || r.action !== 'reused')));
  const graph = assignLanes(visible);
  const laneCount = visible.length ? (graph.get(visible[0])?.laneCount ?? 1) : 1;
  // Room for every lane plus a pending-branch stub curving right of the last one.
  const gutter = (laneCount + 1) * LANE_W;

  const canUndo = modeler.canUndo();
  const canRedo = modeler.canRedo();

  const invalidate = async (r: ProvenanceRecord) => {
    await executeCommand(modeler, {
      type: 'InvalidateProvenanceRecord',
      elementId: r.scopeId,
      entry: r.entry,
      who: getStoredUserEmail(),
      with: `studyflow-modeler/${import.meta.env.APP_VERSION}`,
    });
    bumpRevision();
  };

  // A `run` names a run repository; each document-level `executed` stamp is one run of the study.
  const repos = new Set(visible.filter((r) => r.run).map((r) => r.run));
  const repoCount = repos.size;
  const studyRuns = visible.filter((r) => r.isDocument && r.action === 'executed').length;
  const repoName = repos.size === 1 ? [...repos][0] : null;
  // The modeler never reads the repository; this is the command to run in a terminal.
  const repoRecipe = repoName ? `git -C runs/${repoName} log --graph --oneline --all` : null;
  const [copied, setCopied] = useState(false);
  const copyRecipe = async () => {
    if (!repoRecipe) return;
    await navigator.clipboard.writeText(repoRecipe);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div className={v.bar}>
        {scope && (
          <span className={chip.base}>
            <i className={`${ICONS.filter} size-3 shrink-0`} aria-hidden="true" />
            <span className="font-mono truncate max-w-[16rem]">{scope}</span>
            <button type="button" onClick={clearViewScope} className={chip.clear} title="Show every record" aria-label="Clear provenance filter">
              <i className={ICONS.close} aria-hidden="true" />
            </button>
          </span>
        )}
        {allRecords.length > 0 && (
          <>
                <span>
                  <strong>{visible.length}</strong> {visible.length === 1 ? 'entry' : 'entries'}
                  {studyRuns > 0 && (
                    <>
                      {' '}· <strong>{studyRuns}</strong> {studyRuns === 1 ? 'run' : 'runs'}
                    </>
                  )}
                  {repoCount > 0 && (
                    <>
                      {' '}· <strong>{repoCount}</strong> {repoCount === 1 ? 'repository' : 'repositories'}
                    </>
                  )}
                </span>
                {hasReused && (
                  <label
                    className="inline-flex items-center gap-1.5 ml-3 cursor-pointer select-none"
                    title="Show steps a run reused"
                  >
                    <input
                      type="checkbox"
                      checked={showReused}
                      onChange={(e) => setShowReused(e.target.checked)}
                      className={d.checkbox}
                    />
                    reused
                  </label>
                )}
                {repoRecipe && (
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <code
                      className="text-[0.6875rem] font-mono text-stone-500 truncate max-w-[22rem]"
                      title="The run repository's history"
                    >
                      {repoRecipe}
                    </code>
                    <button
                      type="button"
                      onClick={copyRecipe}
                      className="text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
                      title="Copy the git command"
                      aria-label="Copy the git history command"
                    >
                      <i className={`${copied ? ICONS.check : ICONS.copy} size-3`} aria-hidden="true" />
                    </button>
                  </span>
                )}
          </>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          <button type="button" onClick={() => { closeView(); openReplay(); }} className={d.headerButton} title="Replay on the canvas" aria-label="Replay on the canvas" disabled={allRecords.length === 0}>
            <i className={`${ICONS.replay} size-4 block`}></i>
          </button>
          <button type="button" onClick={() => executeCommand(modeler, { type: 'Undo' })} disabled={!canUndo} className={d.headerButton} title="Undo" aria-label="Undo">
            <i className={`${ICONS.undo} size-4 block`}></i>
          </button>
          <button type="button" onClick={() => executeCommand(modeler, { type: 'Redo' })} disabled={!canRedo} className={d.headerButton} title="Redo" aria-label="Redo">
            <i className={`${ICONS.redo} size-4 block`}></i>
          </button>
        </span>
      </div>
            {visible.length === 0 ? (
              <div className={v.empty}>
                <p>{scope ? <>Nothing recorded for <span className="font-mono">{scope}</span> yet.</> : 'No runs yet.'}</p>
                {!scope && <button type="button" className={v.emptyAction} onClick={() => pressRun(modeler)}>Run the study</button>}
              </div>
            ) : (
              <ol className="relative overflow-x-clip" data-testid="provenance-log">
                {visible.map((r, idx) => {
                  const voided = !!r.invalidated;
                  // A consumed marker is inert history, a `reused` line is a skip; both grey and dimmed.
                  const red = voided || (r.action === 'invalidated' && !r.consumed);
                  const muted = !!r.consumed || r.action === 'reused';
                  const g = graph.get(r) ?? { lane: 0, laneCount: 1, lines: [] };
                  return (
                    <li
                      key={idx}
                      className={`relative py-1 cursor-pointer rounded-md ${!r.isDocument && selection.includes(r.scopeId) ? v.selected : ''}`}
                      style={{ paddingLeft: ICON_GUTTER + gutter + 8 }}
                      onClick={() => { if (!r.isDocument) showElement(modeler, r.scopeId); }}
                    >
                      {r.icon && (
                        <i
                          className={`${r.icon} size-3.5 absolute left-0 top-[0.5625rem] ${red ? 'text-red-400' : 'text-stone-500'} ${muted ? 'opacity-60' : ''}`}
                          aria-hidden="true"
                        />
                      )}
                      <svg className="absolute inset-y-0 h-full overflow-visible" style={{ left: ICON_GUTTER }} width={gutter} aria-hidden="true">
                        {g.lines.map((ln) => (
                          <line
                            key={ln.lane}
                            x1={laneX(ln.lane)}
                            y1={ln.fromDot ? 16 : ln.fromCurve ? 14 : 0}
                            x2={laneX(ln.lane)}
                            y2={ln.toDot ? 16 : '100%'}
                            className={laneOf(ln.lane).stroke}
                            strokeWidth="1.5"
                          />
                        ))}
                        {g.opens != null && (
                          <path
                            d={`M ${laneX(g.lane)} 21 C ${laneX(g.lane)} 34, ${laneX(g.opens)} 30, ${laneX(g.opens)} 46`}
                            className={`fill-none ${laneOf(g.opens).stroke}`}
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        )}
                        {g.pendingBranch && (
                          <path
                            d={`M ${laneX(g.lane)} 21 C ${laneX(g.lane)} 31, ${laneX(g.lane) + 12} 28, ${laneX(g.lane) + 12} 42`}
                            className="fill-none stroke-red-400/80"
                            strokeWidth="1.5"
                            strokeDasharray="3 2"
                            strokeLinecap="round"
                          />
                        )}
                      </svg>
                      <span
                        className={`absolute top-[0.71875rem] size-[0.5625rem] rounded-full ring-2 ring-cream-100 ${voided ? 'bg-red-300' : muted ? 'bg-stone-300 opacity-60' : red ? 'bg-red-500' : laneOf(g.lane).dot}`}
                        style={{ left: ICON_GUTTER + g.lane * 12 }}
                        aria-hidden="true"
                      />
                      <div
                        className={`flex items-center gap-x-2.5 flex-nowrap min-w-0 rounded-md -mx-1.5 px-1.5 py-0.5 ${red ? 'bg-red-500/[0.06]' : 'hover:bg-black/[0.03]'} ${muted ? 'opacity-60' : ''} transition-colors`}
                      >
                        <span
                          className={`text-sm font-semibold ${voided ? 'text-red-700 line-through decoration-red-400' : red ? 'text-red-600' : 'text-stone-900'}`}
                        >
                          {r.action}
                        </span>
                        <span
                          className={`text-[0.6875rem] font-mono truncate max-w-[12rem] shrink-0 ${red ? 'text-red-700/80' : 'text-stone-500'}`}
                          title={r.isDocument ? r.scopeId : r.scopeLabel}
                        >
                          {r.isDocument ? (r.action === 'executed' ? r.scopeId : 'document') : r.scopeId}
                        </span>
                        {g.pendingBranch && (
                          <span
                            className="inline-flex items-center gap-1 text-[0.6875rem] text-red-500/90 whitespace-nowrap"
                            title="The next run re-runs from here"
                          >
                            <i className={`${ICONS.branch} size-3 shrink-0`} aria-hidden="true" />
                            branches here
                          </span>
                        )}
                        {r.action === 'invalidated' && !r.isDocument && !r.what && (
                          <span
                            className="inline-flex items-center gap-1 text-[0.6875rem] text-amber-600/90 whitespace-nowrap"
                            title="Re-runs on every run"
                          >
                            <i className={`${ICONS.pin} size-3 shrink-0`} aria-hidden="true" />
                            re-run pin
                          </span>
                        )}
                        {recordDetails(r).map(([label, value]) => (
                          <span
                            key={label}
                            className={`inline-flex items-center gap-1 min-w-0 text-[0.6875rem] font-mono ${red ? 'text-red-700/70' : 'text-stone-500'}`}
                            title={`${label}: ${value}`}
                          >
                            <i
                              className={`${DETAIL_ICONS[label] ?? ICONS.threeDots} size-3 shrink-0 ${red ? 'text-red-400' : 'text-stone-500'}`}
                              aria-hidden="true"
                            />
                            <span className="truncate max-w-[10rem]">{value}</span>
                          </span>
                        ))}
                        <span className="flex-1" aria-hidden="true" />
                        <span
                          className={`text-[0.6875rem] font-mono whitespace-nowrap shrink-0 ${red ? 'text-red-400' : 'text-stone-500'}`}
                          title={r.when}
                        >
                          {shortWhen(r.when) ?? '—'}
                        </span>
                        {r.standing && (
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); void invalidate(r); }}
                            className="text-stone-500 hover:text-red-600 transition-colors cursor-pointer"
                            title="Invalidate: the next run re-runs this step and what depends on it"
                            aria-label={`Invalidate ${r.action} record of ${r.scopeId}`}
                          >
                            <i className={`${ICONS.close} size-3.5 block`} aria-hidden="true"></i>
                          </button>
                        )}
                      </div>
                      {r.note && (
                        <p className={`pt-0.5 px-0 text-xs italic ${red ? 'text-red-500/80' : 'text-stone-500'}`}>{r.note}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
    </>
  );
}
