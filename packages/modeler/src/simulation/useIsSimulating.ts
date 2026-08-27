import { useCallback, useSyncExternalStore } from 'react';
import { TOGGLE_SIMULATION_EVENT } from '@modeler/simulation/TokenSimulator';
import type { Editor } from '@modeler/editor/port';

export function useIsSimulating(modeler: Editor | undefined): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (!modeler) return () => {};
    const { events } = modeler;
    events.on(TOGGLE_SIMULATION_EVENT, onChange);
    return () => events.off(TOGGLE_SIMULATION_EVENT, onChange);
  }, [modeler]);

  const getSnapshot = useCallback(
    () => (modeler ? modeler.simulation.isActive() : false),
    [modeler],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
