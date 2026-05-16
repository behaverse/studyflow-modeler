import { useEffect, useState } from 'react';
import { TOGGLE_SIMULATION_EVENT } from './TokenSimulator';

/** Tracks simulator active state via its toggle event; no parallel mirror needed. */
export function useIsSimulating(modeler: any): boolean {
  const [isSimulating, setIsSimulating] = useState(false);

  useEffect(() => {
    if (!modeler) return;
    const eventBus = modeler.get('eventBus');
    setIsSimulating(modeler.get('tokenSimulator').isActive());
    const onToggle = ({ active }: { active: boolean }) => setIsSimulating(active);
    eventBus.on(TOGGLE_SIMULATION_EVENT, onToggle);
    return () => eventBus.off(TOGGLE_SIMULATION_EVENT, onToggle);
  }, [modeler]);

  return isSimulating;
}
