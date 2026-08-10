import { useContext } from 'react';
import { ModelerContext } from '@/modeler/app/contexts';
import type { Modeler } from '@/modeler/bpmn/types';

export function useModeler(): Modeler | undefined {
  return useContext(ModelerContext).modeler;
}

export function useRequiredModeler(): Modeler {
  const modeler = useModeler();
  if (!modeler) throw new Error('useRequiredModeler: no modeler in context (view mounted before boot?)');
  return modeler;
}
