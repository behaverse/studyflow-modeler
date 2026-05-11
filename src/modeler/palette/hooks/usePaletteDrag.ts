import { useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { executeCommand } from '../../commands';
import type { PaletteEntry } from '../../constants';
import type { PaletteSchemaTemplate } from '../../commands/palette/paletteSetup';

export type PaletteDraggable = PaletteEntry | (PaletteSchemaTemplate & { __template: true });

export type PaletteDragHandlers = {
  onMouseDown: (entry: PaletteDraggable, event: ReactMouseEvent) => void;
  onMouseMove: (entry: PaletteDraggable, event: ReactMouseEvent) => void;
  onMouseUp: () => void;
  onClick: (entry: PaletteDraggable, event: ReactMouseEvent) => void;
};

function isTemplate(entry: PaletteDraggable): entry is PaletteSchemaTemplate & { __template: true } {
  return (entry as any).__template === true;
}

/**
 * Drag-vs-click dispatch for palette buttons.
 *
 * A mouse move after mousedown initiates a drag-create; a plain click (no
 * prior drag) dispatches an immediate create. `onBeforeAction` lets the
 * owning component close its flyout before the action fires. Templates
 * route through `palette-start-create-template`; plain types through
 * `palette-start-create`.
 */
export function usePaletteDrag(
  modeler: any,
  onBeforeAction?: () => void,
): PaletteDragHandlers {
  const mouseDownRef = useRef(false);
  const startedRef = useRef(false);

  const dispatchCreate = (entry: PaletteDraggable, nativeEvent: MouseEvent) => {
    if (isTemplate(entry)) {
      executeCommand(modeler, {
        type: 'palette-start-create-template',
        templateId: entry.id,
        event: nativeEvent,
      });
      return;
    }
    executeCommand(modeler, {
      type: 'palette-start-create',
      bpmnType: entry.bpmnType,
      event: nativeEvent,
      attrs: {},
      studyflowType: entry.studyflowType,
    });
  };

  return {
    onMouseDown: (_entry, event) => {
      mouseDownRef.current = true;
      startedRef.current = false;
      event.preventDefault();
    },

    onMouseMove: (entry, event) => {
      if (!modeler) return;
      if (!mouseDownRef.current || startedRef.current) return;
      startedRef.current = true;
      event.preventDefault();
      onBeforeAction?.();
      dispatchCreate(entry, event.nativeEvent);
    },

    onMouseUp: () => {
      mouseDownRef.current = false;
    },

    onClick: (entry, event) => {
      if (!modeler) return;
      event.preventDefault();
      if (startedRef.current) {
        startedRef.current = false;
        mouseDownRef.current = false;
        return;
      }
      onBeforeAction?.();
      dispatchCreate(entry, event.nativeEvent);
    },
  };
}
