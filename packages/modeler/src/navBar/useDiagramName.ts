import { useCallback, useEffect, useState } from 'react';
import { executeCommand } from '@modeler/commandBus';
import { getDiagramName } from '@modeler/diagram/file';
import type { Modeler } from '@modeler/bpmn/types';

const DEFAULT_DIAGRAM_NAME = 'Untitled Diagram';

export function useDiagramName(modeler: Modeler): {
  diagramName: string;
  rename: (name: string) => void;
} {
  const [diagramName, setDiagramName] = useState(DEFAULT_DIAGRAM_NAME);

  useEffect(() => {
    if (!modeler) return;
    const eventBus = modeler.get('eventBus');
    const canvas = modeler.get('canvas');
    const sync = () => setDiagramName(getDiagramName(modeler) ?? DEFAULT_DIAGRAM_NAME);
    const onRootChanged = (e: any) => {
      if (e?.element === canvas.getRootElement()) sync();
    };
    sync();
    eventBus.on('import.done', sync);
    eventBus.on('element.changed', onRootChanged);
    return () => {
      eventBus.off('import.done', sync);
      eventBus.off('element.changed', onRootChanged);
    };
  }, [modeler]);

  const rename = useCallback((name: string) => {
    if (!modeler) return;
    const root = modeler.get('canvas')?.getRootElement?.();
    if (!root) return;
    const value = name === DEFAULT_DIAGRAM_NAME ? undefined : name;
    if (root.businessObject.name === value) return;
    executeCommand(modeler, { type: 'UpdateAttribute', element: root, attributeName: 'name', value });
  }, [modeler]);

  return { diagramName, rename };
}
