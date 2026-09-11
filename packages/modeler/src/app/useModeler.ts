import { useContext } from 'react';
import { ModelerContext } from '@modeler/app/contexts';
import type { Editor } from '@modeler/editor/port';

/** The editor. Only what App mounts after boot calls this, so it is always there. */
export function useModeler(): Editor {
  const modeler = useContext(ModelerContext);
  if (!modeler) throw new Error('useModeler: no editor yet (a view mounted before boot?)');
  return modeler;
}
