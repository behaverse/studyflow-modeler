import { useEffect, useState } from 'react';
import { getDiagramName } from '@modeler/diagram/name';
import type { Editor } from '@modeler/editor/port';

/** The study's name as it changes, `undefined` while it has none. */
export function useDiagramName(modeler: Editor): string | undefined {
  const [diagramName, setDiagramName] = useState(() => getDiagramName(modeler));

  useEffect(() => {
    const sync = () => setDiagramName(getDiagramName(modeler));
    sync();
    return modeler.study.on('change', sync);
  }, [modeler]);

  return diagramName;
}
