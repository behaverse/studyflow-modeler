import { useContext, useEffect, useMemo, useReducer, useState } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { ReplayContext } from '@modeler/app/contexts';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { getStoredUserEmail } from '@modeler/settings/store';
import {
  assignLanes,
  collectProvenance,
  displayOrder,
  recordDetails,
  type ProvenanceRecord,
} from '@modeler/provenance/records';
import { dialog as d } from '@modeler/ui/styles';
import { DialogHelp } from '@modeler/ui/DialogHelp';
import { ICONS } from '@modeler/icons';

type Props = { isOpen: boolean; onClose: () => void; scopeId?: string };

// Icons standing in for the `recordDetails` labels (who/with/run/seed/what).
const DETAIL_ICONS: Record<string, string> = {
  who: ICONS.person,
  with: ICONS.cog,
  run: ICONS.play,
  seed: ICONS.asterisk,
  what: ICONS.script,
};

// One color per branch
const LANES = [
  { dot: 'bg-stone-400', stroke: 'stroke-stone-300/70' },
  { dot: 'bg-violet-500', stroke: 'stroke-violet-400/70' },
  { dot: 'bg-sky-500', stroke: 'stroke-sky-400/70' },
  { dot: 'bg-amber-500', stroke: 'stroke-amber-400/70' },
  { dot: 'bg-emerald-500', stroke: 'stroke-emerald-400/70' },
];
const LANE_W = 12;
const laneOf = (lane: number) => LANES[lane % LANES.length];
const laneX = (lane: number) => lane * LANE_W + 4.5;
// The element-shape icons sit in their own left column, outside the tree, so they align.
const ICON_GUTTER = 22;

// Compact UTC render for mixed-offset stamps, seconds included; the raw stamp stays in the tooltip.
export function shortWhen(when?: string): string | undefined {
  const parsed = when ? Date.parse(when) : NaN;
  if (Number.isNaN(parsed)) return when || undefined;
  return new Date(parsed).toISOString().slice(0, 19).replace('T', ' ');
}

export function ProvenanceDialog({ isOpen, onClose, scopeId }: Props) {
  const modeler = useRequiredModeler();
  const { openReplay } = useContext(ReplayContext);
  const [revision, bumpRevision] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const eventBus = modeler?.get?.('eventBus', false);
    if (!eventBus) return undefined;
    eventBus.on('commandStack.changed', bumpRevision);
    return () => eventBus.off('commandStack.changed', bumpRevision);
  }, [modeler]);

  // The dialog unmounts on close, so the scope filter re-arms from the prop on every open.
  const [scope, setScope] = useState(scopeId);
  const [showReused, setShowReused] = useState(true);
  const allRecords = useMemo(
    () => collectProvenance(modeler?.getDefinitions?.()),
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

  const commandStack = modeler?.get?.('commandStack', false);
  const canUndo = !!commandStack?.canUndo?.();
  const canRedo = !!commandStack?.canRedo?.();

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
  // The modeler never reads the repository itself, the terminal does; this hands over the reins.
  const repoRecipe = repoName ? `git -C runs/${repoName} log --graph --oneline --all` : null;
  const [copied, setCopied] = useState(false);
  const copyRecipe = async () => {
    if (!repoRecipe) return;
    await navigator.clipboard.writeText(repoRecipe);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Provenance View"
      size="xl"
      help={<DialogHelp>
                Who changed this studyflow and who ran it, oldest first — marked by the modeler and the runner, and stored inside the studyflow diagram itself.
                Invalidating a run record (<i className={ICONS.closeSmall} aria-hidden="true" />)
                appends a marker rather than deleting anything, so the next run re-executes only that step and what depends on it.
                The replay button (<i className={ICONS.playFill} aria-hidden="true" />) plays this timeline back on the canvas, step by step.
              </DialogHelp>}
      actions={(
        <>
          <button
            type="button"
            onClick={() => { onClose(); openReplay(); }}
            className={d.titleAction}
            title="Replay this timeline on the canvas — elements light up in order and a token marks each step"
            aria-label="Replay on the canvas"
          >
            <i className={`${ICONS.playFill} size-4 block`}></i>
          </button>
          <button
            type="button"
            onClick={() => executeCommand(modeler, { type: 'Undo' })}
            disabled={!canUndo}
            className={d.titleAction}
            title="Undo the last edit (an invalidation, say)"
            aria-label="Undo"
          >
            <i className={`${ICONS.undo} size-4 block`}></i>
          </button>
          <button
            type="button"
            onClick={() => executeCommand(modeler, { type: 'Redo' })}
            disabled={!canRedo}
            className={d.titleAction}
            title="Redo the undone edit"
            aria-label="Redo"
          >
            <i className={`${ICONS.redo} size-4 block`}></i>
          </button>
        </>
      )}
    >
            {scope && (
              <p className="text-xs text-stone-500 pb-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-200/70 px-2 py-0.5">
                  <i className={`${ICONS.filter} size-3 shrink-0`} aria-hidden="true" />
                  <span className="font-mono truncate max-w-[16rem]">{scope}</span>
                  <button
                    type="button"
                    onClick={() => setScope(undefined)}
                    className="text-stone-400 hover:text-stone-700 transition-colors cursor-pointer pt-1 "
                    title="Clear the filter and show the whole timeline"
                    aria-label="Clear provenance filter"
                  >
                    <i className={ICONS.closeSmall} aria-hidden="true" />
                  </button>
                </span>
              </p>
            )}
            {allRecords.length > 0 && (
              <p className="text-xs text-stone-500 pb-3 flex items-center">
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
                    title="Show the dimmed reused lines — steps a run skipped, trusting an earlier record"
                  >
                    <input
                      type="checkbox"
                      checked={showReused}
                      onChange={(e) => setShowReused(e.target.checked)}
                      className="size-3 accent-stone-500 cursor-pointer"
                    />
                    reused
                  </label>
                )}
                {repoRecipe && (
                  <span className="inline-flex items-center gap-1.5 ml-auto pl-4">
                    <code
                      className="text-[10px] font-mono text-stone-400 truncate max-w-[22rem]"
                      title="The repository's history — each run is a started/finished commit pair, each post-invalidation re-run a run/<stamp> branch"
                    >
                      {repoRecipe}
                    </code>
                    <button
                      type="button"
                      onClick={copyRecipe}
                      className="text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
                      title="Copy the git command"
                      aria-label="Copy the git history command"
                    >
                      <i className={`${copied ? ICONS.check : ICONS.copy} size-3`} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </p>
            )}
            {visible.length === 0 ? (
              <p className="text-sm text-stone-500 italic">
                {scope
                  ? <>No provenance recorded for <span className="font-mono not-italic">{scope}</span> yet.</>
                  : 'No provenance yet.'}
              </p>
            ) : (
              <ol className={`${d.panelBody} relative overflow-x-clip`} data-testid="provenance-log">
                {visible.map((r, idx) => {
                  const voided = !!r.invalidated;
                  // A consumed marker is inert history, a `reused` line is a skip; both grey and dimmed.
                  const red = voided || (r.action === 'invalidated' && !r.consumed);
                  const muted = !!r.consumed || r.action === 'reused';
                  const g = graph.get(r) ?? { lane: 0, laneCount: 1, lines: [] };
                  return (
                    <li
                      key={idx}
                      className="relative py-1"
                      style={{ paddingLeft: ICON_GUTTER + gutter + 8 }}
                    >
                      {r.icon && (
                        <i
                          className={`${r.icon} size-3.5 absolute left-0 top-[9px] ${red ? 'text-red-400' : 'text-stone-500'} ${muted ? 'opacity-60' : ''}`}
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
                        className={`absolute top-[11.5px] size-[9px] rounded-full ring-2 ring-cream-100 ${voided ? 'bg-red-300' : muted ? 'bg-stone-300 opacity-60' : red ? 'bg-red-500' : laneOf(g.lane).dot}`}
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
                          className={`text-[11px] font-mono truncate max-w-[12rem] shrink-0 ${red ? 'text-red-700/80' : 'text-stone-500'}`}
                          title={r.isDocument ? r.scopeId : r.scopeLabel}
                        >
                          {r.isDocument ? (r.action === 'executed' ? r.scopeId : 'document') : r.scopeId}
                        </span>
                        {g.pendingBranch && (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] text-red-500/90 whitespace-nowrap"
                            title="The next run starts a new run/<stamp> branch just before this step — only the step and what depends on it re-execute"
                          >
                            <i className={`${ICONS.branch} size-3 shrink-0`} aria-hidden="true" />
                            branches here
                          </span>
                        )}
                        {r.action === 'invalidated' && !r.isDocument && !r.what && (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] text-amber-600/90 whitespace-nowrap"
                            title="A marker naming no specific record: this step re-runs every time, in place — it never branches and never ages out"
                          >
                            <i className={`${ICONS.pin} size-3 shrink-0`} aria-hidden="true" />
                            re-run pin
                          </span>
                        )}
                        {recordDetails(r).map(([label, value]) => (
                          <span
                            key={label}
                            className={`inline-flex items-center gap-1 min-w-0 text-[11px] font-mono ${red ? 'text-red-700/70' : 'text-stone-500'}`}
                            title={`${label}: ${value}`}
                          >
                            <i
                              className={`${DETAIL_ICONS[label] ?? ICONS.threeDots} size-3 shrink-0 ${red ? 'text-red-400' : 'text-stone-400'}`}
                              aria-hidden="true"
                            />
                            <span className="truncate max-w-[10rem]">{value}</span>
                          </span>
                        ))}
                        <span className="flex-1" aria-hidden="true" />
                        <span
                          className={`text-[11px] font-mono whitespace-nowrap shrink-0 ${red ? 'text-red-400' : 'text-stone-400'}`}
                          title={r.when}
                        >
                          {shortWhen(r.when) ?? '—'}
                        </span>
                        {r.standing && (
                          <button
                            type="button"
                            onClick={() => invalidate(r)}
                            className="text-stone-400 hover:text-red-600 transition-colors cursor-pointer"
                            title="Invalidate this run record — kept in the timeline; the next run branches just before this step and re-executes only what depends on it"
                            aria-label={`Invalidate ${r.action} record of ${r.scopeId}`}
                          >
                            <i className={`${ICONS.closeSmall} size-3.5 block`} aria-hidden="true"></i>
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
    </Modal>
  );
}
