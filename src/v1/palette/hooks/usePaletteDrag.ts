import { useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { executeCommand } from '../../commands';
import type { PaletteEntry } from '../../constants/palette';

export type PaletteDragHandlers = {
  onMouseDown: (entry: PaletteEntry, event: ReactMouseEvent) => void;
  onMouseMove: (entry: PaletteEntry, event: ReactMouseEvent) => void;
  onMouseUp: () => void;
  onClick: (entry: PaletteEntry, event: ReactMouseEvent) => void;
};

/**
 * Drag-vs-click dispatch for palette buttons.
 *
 * A mouse move after mousedown initiates a drag-create; a plain click (no
 * prior drag) dispatches an immediate create. `onBeforeAction` lets the
 * owning component close its flyout before the action fires.
 */
export function usePaletteDrag(
  modeler: any,
  onBeforeAction?: () => void,
): PaletteDragHandlers {
  const mouseDownRef = useRef(false);
  const startedRef = useRef(false);

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
      executeCommand(modeler, {
        type: 'palette-start-create',
        bpmnType: entry.bpmnType,
        event: event.nativeEvent,
        attrs: {},
        studyflowType: entry.studyflowType,
      });
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
      executeCommand(modeler, {
        type: 'palette-start-create',
        bpmnType: entry.bpmnType,
        event: event.nativeEvent,
        attrs: {},
        studyflowType: entry.studyflowType,
      });
    },
  };
}
