import { useCallback, useSyncExternalStore } from 'react';
import { TOGGLE_SIMULATION_EVENT } from '@/modeler/simulation/TokenSimulator';
import type { Modeler } from '@/modeler/bpmn/types';

export function useIsSimulating(modeler: Modeler | undefined): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (!modeler) return () => {};
    const eventBus = modeler.get('eventBus');
    eventBus.on(TOGGLE_SIMULATION_EVENT, onChange);
    return () => eventBus.off(TOGGLE_SIMULATION_EVENT, onChange);
  }, [modeler]);

  const getSnapshot = useCallback(
    () => modeler?.get('tokenSimulator')?.isActive() ?? false,
    [modeler],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
