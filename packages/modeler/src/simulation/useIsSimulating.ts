import { useCallback, useSyncExternalStore } from 'react';
import { TOGGLE_SIMULATION_EVENT } from '@modeler/simulation/TokenSimulator';
import { getEditorPort } from '@modeler/editor/registry';
import type { EditorHandle } from '@modeler/editor/registry';

export function useIsSimulating(modeler: EditorHandle | undefined): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (!modeler) return () => {};
    const { events } = getEditorPort(modeler);
    events.on(TOGGLE_SIMULATION_EVENT, onChange);
    return () => events.off(TOGGLE_SIMULATION_EVENT, onChange);
  }, [modeler]);

  const getSnapshot = useCallback(
    () => (modeler ? getEditorPort(modeler).simulation.isActive() : false),
    [modeler],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
