import { useCallback, useSyncExternalStore } from 'react';
import { TOGGLE_SIMULATION_EVENT } from '@modeler/simulation/TokenSimulator';
import type { Editor } from '@modeler/editor/port';

/** Re-reads `read` whenever the simulation starts, stops, pauses or resumes. */
function useSimulationState(modeler: Editor | undefined, read: (modeler: Editor) => boolean): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (!modeler) return () => {};
    const { events } = modeler;
    events.on(TOGGLE_SIMULATION_EVENT, onChange);
    return () => events.off(TOGGLE_SIMULATION_EVENT, onChange);
  }, [modeler]);

  const getSnapshot = useCallback(() => (modeler ? read(modeler) : false), [modeler, read]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

const isActive = (modeler: Editor): boolean => modeler.simulation.isActive();
const isPaused = (modeler: Editor): boolean => modeler.simulation.isPaused();

export function useIsSimulating(modeler: Editor | undefined): boolean {
  return useSimulationState(modeler, isActive);
}

export function useIsSimulationPaused(modeler: Editor | undefined): boolean {
  return useSimulationState(modeler, isPaused);
}
