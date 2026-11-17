import { useContext, useState } from 'react';
import { ModeContext } from '@modeler/app/contexts';
import { useModeler } from '@modeler/app/useModeler';
import { openRunnerTab } from '@modeler/app/commands';
import { notify } from '@modeler/app/noticeStore';
import { executeCommand } from '@modeler/commandBus';
import { ICONS } from '@modeler/icons';
import { row, modeActions as s } from '@modeler/navbar/styles';

function RunButton() {
  const modeler = useModeler();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    // Claimed before the first `await`, while this click still counts as a user gesture.
    const target = openRunnerTab();
    setBusy(true);
    try {
      await executeCommand(modeler, { type: 'OpenRunner', target });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Could not start the runner. Try again, or reload the page.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" title="Open this study in the runner" disabled={busy} className={s.runButton} onClick={handleClick}>
      Run
    </button>
  );
}

/**
 * The row's right bar: what to do in the app's mode, on that mode's tint. Editing, it simulates or runs the study and
 * toggles the inspector; a simulation or a replay shows itself and its way out.
 */
export function ModeActions({ className, isInspectorVisible, onToggleInspector }: {
  className: string;
  isInspectorVisible: boolean;
  onToggleInspector: () => void;
}) {
  const modeler = useModeler();
  const { mode, exitReplay } = useContext(ModeContext);
  const toggleSimulation = () => executeCommand(modeler, { type: 'ToggleSimulation' });
  const inspectorTitle = isInspectorVisible ? 'Hide Inspector' : 'Show Inspector';

  return (
    <div className={`${row.bar} ${s.tint[mode]} ${className}`} data-covers="top" data-mode={mode}>
      {mode === 'edit' && (
        <>
          <div className={s.run}>
            <button type="button" title="Simulate the study" className={s.simulate} onClick={toggleSimulation}>
              Simulate
            </button>
            <RunButton />
          </div>
          <div className={s.divider} />
          <button type="button" title={inspectorTitle} aria-label={inspectorTitle} className={s.iconButton} onClick={onToggleInspector}>
            <i className={`${isInspectorVisible ? ICONS.inspectorHide : ICONS.inspectorShow} ${s.inspectorIcon}`} aria-hidden="true" />
          </button>
        </>
      )}
      {mode === 'simulation' && (
        <>
          <span className={`${s.label} ${s.simulationLabel}`}>
            <i className={ICONS.simulate} aria-hidden="true" />
            Simulating
          </span>
          <button type="button" title="Stop simulation" className={s.stop} onClick={toggleSimulation}>
            <i className={ICONS.stop} aria-hidden="true" />
            Stop
          </button>
        </>
      )}
      {mode === 'replay' && (
        <>
          <span className={`${s.label} ${s.replayLabel}`}>
            <i className={ICONS.replay} aria-hidden="true" />
            Replaying
          </span>
          <button type="button" title="Exit the replay" className={s.exitReplay} onClick={exitReplay}>
            <i className={ICONS.close} aria-hidden="true" />
            Exit
          </button>
        </>
      )}
    </div>
  );
}
