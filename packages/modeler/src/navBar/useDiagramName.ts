import { useCallback, useEffect, useState } from 'react';
import { executeCommand } from '@modeler/commandBus';
import { getDiagramName } from '@modeler/diagram/name';
import type { Editor } from '@modeler/editor/port';

/** The study's name as it changes, `undefined` while it has none, and a rename of it (an empty name clears it). */
export function useDiagramName(modeler: Editor): {
  diagramName: string | undefined;
  rename: (name: string) => void;
} {
  const [diagramName, setDiagramName] = useState(() => getDiagramName(modeler));

  useEffect(() => {
    const sync = () => setDiagramName(getDiagramName(modeler));
    sync();
    return modeler.study.on('change', sync);
  }, [modeler]);

  const rename = useCallback((name: string) => {
    const root = modeler.study.root;
    const value = name || undefined;
    if (root.name === value) return;
    executeCommand(modeler, { type: 'UpdateAttribute', element: root, attributeName: 'name', value });
  }, [modeler]);

  return { diagramName, rename };
}
