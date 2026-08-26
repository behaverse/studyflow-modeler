import { useContext } from 'react';
import { ModelerContext } from '@modeler/app/contexts';
import type { PortHandle } from '@modeler/editor/registry';

export function useModeler(): PortHandle | undefined {
  return useContext(ModelerContext).modeler;
}

export function useRequiredModeler(): PortHandle {
  const modeler = useModeler();
  if (!modeler) throw new Error('useRequiredModeler: no modeler in context (view mounted before boot?)');
  return modeler;
}
