import { useEffect, useMemo, useReducer } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { getStoredUserEmail } from '@modeler/settings/store';
import {
  collectProvenance,
  recordDetails,
  type ProvenanceRecord,
} from '@modeler/provenance/records';
import { dialog as d } from '@modeler/ui/styles';
import { DialogHelp } from '@modeler/ui/DialogHelp';
import { ICONS } from '@modeler/icons';

type Props = { isOpen: boolean; onClose: () => void };

// Commit-dot colors per action; unknown actions fall back to stone.
const ACTION_DOT: Record<string, string> = {
  created: 'bg-emerald-500',
  imported: 'bg-sky-500',
  modified: 'bg-amber-500',
  executed: 'bg-violet-500',
  invalidated: 'bg-red-500',
};

// Icons standing in for the `recordDetails` labels (who/with/run/seed/what).
const DETAIL_ICONS: Record<string, string> = {
  who: ICONS.person,
  with: ICONS.cog,
  run: ICONS.play,
  seed: ICONS.asterisk,
  what: ICONS.script,
};

// Compact UTC render for mixed-offset stamps; the raw stamp stays in the tooltip.
function shortWhen(when?: string): string | undefined {
  const parsed = when ? Date.parse(when) : NaN;
  if (Number.isNaN(parsed)) return when || undefined;
  return new Date(parsed).toISOString().slice(0, 16).replace('T', ' ');
}

export function ProvenanceDialog({ isOpen, onClose }: Props) {
  const modeler = useRequiredModeler();
  const [, bumpRevision] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const eventBus = modeler?.get?.('eventBus', false);
    if (!eventBus) return undefined;
    eventBus.on('commandStack.changed', bumpRevision);
    return () => eventBus.off('commandStack.changed', bumpRevision);
  }, [modeler]);

  const records = collectProvenance(modeler?.getDefinitions?.());

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

  const runCount = useMemo(
    () => new Set(records.filter((r) => r.run).map((r) => r.run)).size,
    [records],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Provenance View"
      size="lg"
      help={<DialogHelp>
                The document's provenance trail — the <code>prov:activity</code> entries
                stamped on the diagram's root as it passes through tools (created,
                modified, imported, executed) — merged with the per-element run records
                the runner leaves on the copy it archives. Entries are ordered oldest
                first; the trail is hand-editable and travels inside the document.
                Invalidating a run record (<i className={ICONS.closeSmall} aria-hidden="true" />)
                appends an <code>invalidated</code> line rather than deleting anything —
                undoable, and the history stays. After exporting, the next partial re-run
                redoes that step and everything downstream of its outputs.
              </DialogHelp>}
      actions={(
        <>
          <button
            type="button"
            onClick={() => executeCommand(modeler, { type: 'Undo' })}
            disabled={!canUndo}
            className={d.titleAction}
            title="Undo the last edit (an invalidation, say)"
            aria-label="Undo"
          >
            <i className={ICONS.arrowCounterclockwise}></i>
          </button>
          <button
            type="button"
            onClick={() => executeCommand(modeler, { type: 'Redo' })}
            disabled={!canRedo}
            className={d.titleAction}
            title="Redo the undone edit"
            aria-label="Redo"
          >
            <i className={ICONS.arrowClockwise}></i>
          </button>
        </>
      )}
    >
            {records.length > 0 && (
              <p className="text-xs text-stone-500 pb-3">
                <strong>{records.length}</strong> {records.length === 1 ? 'entry' : 'entries'}
                {runCount > 0 && (
                  <>
                    {' '}· <strong>{runCount}</strong> {runCount === 1 ? 'run' : 'runs'}
                  </>
                )}
              </p>
            )}
            {records.length === 0 ? (
              <p className="text-sm text-stone-500 italic">
                This diagram carries no provenance trail yet.
              </p>
            ) : (
              <ol
                className={`${d.panelBody} relative before:absolute before:left-[8px] before:top-3 before:bottom-3 before:w-px before:bg-stone-300/70`}
                data-testid="provenance-log"
              >
                {records.map((r, idx) => {
                  const voided = !!r.invalidated;
                  const red = voided || r.action === 'invalidated';
                  return (
                    <li key={idx} className="relative pl-6 py-1">
                      <span
                        className={`absolute left-0 top-[9px] size-[9px] rounded-full ring-2 ring-cream-100 ${voided ? 'bg-red-300' : ACTION_DOT[r.action] ?? 'bg-stone-400'}`}
                        aria-hidden="true"
                      />
                      <div
                        className={`flex items-center gap-x-2.5 gap-y-0.5 flex-wrap rounded-md -mx-1.5 px-1.5 py-0.5 ${red ? 'bg-red-500/[0.06]' : 'hover:bg-black/[0.03]'} transition-colors`}
                      >
                        <span
                          className={`text-sm font-semibold ${voided ? 'text-red-700 line-through decoration-red-400' : red ? 'text-red-600' : 'text-stone-900'}`}
                        >
                          {r.action}
                        </span>
                        {r.icon && (
                          <i
                            className={`${r.icon} size-3.5 shrink-0 ${red ? 'text-red-400' : 'text-stone-500'}`}
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={`text-[11px] font-mono truncate max-w-[12rem] ${red ? 'text-red-700/80' : 'text-stone-500'}`}
                          title={r.isDocument ? r.scopeId : r.scopeLabel}
                        >
                          {r.isDocument ? 'document' : r.scopeId}
                        </span>
                        {recordDetails(r).map(([label, value]) => (
                          <span
                            key={label}
                            className={`inline-flex items-center gap-1 text-[11px] font-mono ${red ? 'text-red-700/70' : 'text-stone-500'}`}
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
                          className={`text-[11px] font-mono whitespace-nowrap ${red ? 'text-red-400' : 'text-stone-400'}`}
                          title={r.when}
                        >
                          {shortWhen(r.when) ?? '—'}
                        </span>
                        {!r.isDocument && r.action === 'executed' && !voided && (
                          <button
                            type="button"
                            onClick={() => invalidate(r)}
                            className="text-stone-400 hover:text-red-600 transition-colors cursor-pointer"
                            title="Invalidate this run record — kept in the trail, and the step (plus everything downstream) re-runs on the next partial re-run"
                            aria-label={`Invalidate ${r.action} record of ${r.scopeId}`}
                          >
                            <i className={ICONS.closeSmall} aria-hidden="true"></i>
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
