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
                    {' '}across <strong>{runCount}</strong> {runCount === 1 ? 'run' : 'runs'}
                  </>
                )}
                .
              </p>
            )}
            {records.length === 0 ? (
              <p className="text-sm text-stone-500 italic">
                This diagram carries no provenance trail yet.
              </p>
            ) : (
              <ol className={`${d.panelBody} space-y-2`} data-testid="provenance-log">
                {records.map((r, idx) => (
                  <li
                    key={idx}
                    className="border border-black/[0.06] rounded-lg px-3 py-2 bg-white/40 flex items-center gap-2"
                  >
                    <span className="w-4 shrink-0" aria-hidden={r.isDocument || undefined}>
                      {!r.isDocument && r.action === 'executed' && !r.invalidated && (
                        <button
                          type="button"
                          onClick={() => invalidate(r)}
                          className="text-stone-400 hover:text-stone-900 transition-colors cursor-pointer"
                          title="Invalidate this run record — kept in the trail, and the step (plus everything downstream) re-runs on the next partial re-run"
                          aria-label={`Invalidate ${r.action} record of ${r.scopeId}`}
                        >
                          <i className={ICONS.closeSmall} aria-hidden="true"></i>
                        </button>
                      )}
                    </span>
                    <div className={`flex-1 min-w-0 ${r.invalidated ? 'opacity-60' : ''}`}>
                      <div className="flex items-baseline gap-3">
                        <span className="text-[11px] font-mono text-stone-500 whitespace-nowrap">
                          {r.when ?? '(undated)'}
                        </span>
                        <span
                          className={`text-sm font-semibold text-stone-900 ${r.invalidated ? 'line-through decoration-stone-400' : ''}`}
                        >
                          {r.action}
                        </span>
                        <span className="flex-1" aria-hidden="true" />
                        {r.icon && (
                          <i
                            className={`${r.icon} size-3.5 shrink-0 self-center text-stone-500`}
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className="text-[11px] font-mono text-stone-500 truncate max-w-[16rem]"
                          title={r.isDocument ? r.scopeId : r.scopeLabel}
                        >
                          {r.isDocument ? 'document' : r.scopeId}
                        </span>
                      </div>
                      {(recordDetails(r).length > 0 || r.note) && (
                        <div className="pt-1 text-xs text-stone-600">
                          {recordDetails(r).map(([label, value], i) => (
                            <span key={label}>
                              {i > 0 && <span className="text-stone-400"> • </span>}
                              <span className="text-stone-400">{label}:</span>{' '}
                              <span className="font-mono">{value}</span>
                            </span>
                          ))}
                          {r.note && (
                            <p className="pt-0.5 italic text-stone-500">{r.note}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
    </Modal>
  );
}
