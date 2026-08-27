import { useContext } from 'react';
import { ModelerContext } from '@modeler/app/contexts';
import type { Editor } from '@modeler/editor/port';

export function useModeler(): Editor | undefined {
  return useContext(ModelerContext).modeler;
}

export function useRequiredModeler(): Editor {
  const modeler = useModeler();
  if (!modeler) throw new Error('useRequiredModeler: no modeler in context (view mounted before boot?)');
  return modeler;
}
