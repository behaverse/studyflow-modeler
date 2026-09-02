import { useCallback, useEffect, useState } from 'react';
import { executeCommand } from '@modeler/commandBus';
import { getDiagramName } from '@modeler/diagram/file';
import type { Editor } from '@modeler/editor/port';

const DEFAULT_DIAGRAM_NAME = 'Untitled Diagram';

export function useDiagramName(modeler: Editor): {
  diagramName: string;
  rename: (name: string) => void;
} {
  const [diagramName, setDiagramName] = useState(DEFAULT_DIAGRAM_NAME);

  useEffect(() => {
    if (!modeler) return;
    const sync = () => setDiagramName(getDiagramName(modeler) ?? DEFAULT_DIAGRAM_NAME);
    const onRootChanged = (e: any) => {
      if (e?.element === modeler.canvas.getRoot()) sync();
    };
    sync();
    modeler.events.on('ImportDone', sync);
    modeler.events.on('ElementChanged', onRootChanged);
    return () => {
      modeler.events.off('ImportDone', sync);
      modeler.events.off('ElementChanged', onRootChanged);
    };
  }, [modeler]);

  const rename = useCallback((name: string) => {
    if (!modeler) return;
    const root = modeler.canvas.getRoot();
    if (!root) return;
    const value = name === DEFAULT_DIAGRAM_NAME ? undefined : name;
    if (root.businessObject.name === value) return;
    executeCommand(modeler, { type: 'UpdateAttribute', element: root, attributeName: 'name', value });
  }, [modeler]);

  return { diagramName, rename };
}
