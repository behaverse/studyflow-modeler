import { useCallback, useEffect, useState } from 'react';
import { executeCommand } from '@modeler/commandBus';
import { getDiagramName } from '@modeler/diagram/name';
import type { Editor } from '@modeler/editor/port';

const DEFAULT_DIAGRAM_NAME = 'Untitled Diagram';

export function useDiagramName(modeler: Editor): {
  diagramName: string;
  rename: (name: string) => void;
} {
  const [diagramName, setDiagramName] = useState(DEFAULT_DIAGRAM_NAME);

  useEffect(() => {
    const sync = () => setDiagramName(getDiagramName(modeler) ?? DEFAULT_DIAGRAM_NAME);
    sync();
    return modeler.study.on('change', sync);
  }, [modeler]);

  const rename = useCallback((name: string) => {
    const root = modeler.study.root;
    const value = name === DEFAULT_DIAGRAM_NAME ? undefined : name;
    if (root.name === value) return;
    executeCommand(modeler, { type: 'UpdateAttribute', element: root, attributeName: 'name', value });
  }, [modeler]);

  return { diagramName, rename };
}
