import { useContext } from 'react';
import { ModelerContext } from '@modeler/app/contexts';
import type { EditorHandle } from '@modeler/editor/registry';

export function useModeler(): EditorHandle | undefined {
  return useContext(ModelerContext).modeler;
}

export function useRequiredModeler(): EditorHandle {
  const modeler = useModeler();
  if (!modeler) throw new Error('useRequiredModeler: no modeler in context (view mounted before boot?)');
  return modeler;
}
