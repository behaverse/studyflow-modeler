import { useCallback, useEffect, useState } from 'react';
import { executeCommand } from '@modeler/commandBus';
import { getDiagramName } from '@modeler/diagram/file';
import { getEditorPort } from '@modeler/editor/registry';
import type { EditorHandle } from '@modeler/editor/registry';

const DEFAULT_DIAGRAM_NAME = 'Untitled Diagram';

export function useDiagramName(modeler: EditorHandle): {
  diagramName: string;
  rename: (name: string) => void;
} {
  const [diagramName, setDiagramName] = useState(DEFAULT_DIAGRAM_NAME);

  useEffect(() => {
    if (!modeler) return;
    const editor = getEditorPort(modeler);
    const sync = () => setDiagramName(getDiagramName(modeler) ?? DEFAULT_DIAGRAM_NAME);
    const onRootChanged = (e: any) => {
      if (e?.element === editor.elements.root()) sync();
    };
    sync();
    editor.events.on('import.done', sync);
    editor.events.on('element.changed', onRootChanged);
    return () => {
      editor.events.off('import.done', sync);
      editor.events.off('element.changed', onRootChanged);
    };
  }, [modeler]);

  const rename = useCallback((name: string) => {
    if (!modeler) return;
    const root = getEditorPort(modeler).elements.root();
    if (!root) return;
    const value = name === DEFAULT_DIAGRAM_NAME ? undefined : name;
    if (root.businessObject.name === value) return;
    executeCommand(modeler, { type: 'UpdateAttribute', element: root, attributeName: 'name', value });
  }, [modeler]);

  return { diagramName, rename };
}
