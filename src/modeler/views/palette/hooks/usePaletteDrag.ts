import { useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { executeCommand } from '@/modeler/controllers/commands';
import type { PaletteEntry } from '@/modeler/infra/constants';
import type { PaletteTemplate } from '@/modeler/controllers/commands/palette/paletteSetup';

export type PaletteDraggable = PaletteEntry | (PaletteTemplate & { __template: true });

export type PaletteDragHandlers = {
  onMouseDown: (draggable: PaletteDraggable, event: ReactMouseEvent) => void;
  onMouseMove: (draggable: PaletteDraggable, event: ReactMouseEvent) => void;
  onMouseUp: () => void;
  onClick: (draggable: PaletteDraggable, event: ReactMouseEvent) => void;
};

function isTemplate(draggable: PaletteDraggable): draggable is PaletteTemplate & { __template: true } {
  return (draggable as any).__template === true;
}

/** Drag-vs-click dispatch for palette buttons; both routes through `executeCommand`. */
export function usePaletteDrag(
  modeler: any,
  onBeforeAction?: () => void,
): PaletteDragHandlers {
  const mouseDownRef = useRef(false);
  const startedRef = useRef(false);

  const dispatchCreate = (draggable: PaletteDraggable, nativeEvent: MouseEvent) => {
    if (isTemplate(draggable)) {
      executeCommand(modeler, {
        type: 'palette-start-create-template',
        templateId: draggable.id,
        event: nativeEvent,
      });
      return;
    }
    executeCommand(modeler, {
      type: 'palette-start-create',
      bpmnType: draggable.bpmnType,
      event: nativeEvent,
      attributes: {},
      extensionType: draggable.extensionType,
    });
  };

  return {
    onMouseDown: (_draggable, event) => {
      mouseDownRef.current = true;
      startedRef.current = false;
      event.preventDefault();
    },

    onMouseMove: (draggable, event) => {
      if (!modeler) return;
      if (!mouseDownRef.current || startedRef.current) return;
      startedRef.current = true;
      event.preventDefault();
      onBeforeAction?.();
      dispatchCreate(draggable, event.nativeEvent);
    },

    onMouseUp: () => {
      mouseDownRef.current = false;
    },

    onClick: (draggable, event) => {
      if (!modeler) return;
      event.preventDefault();
      if (startedRef.current) {
        startedRef.current = false;
        mouseDownRef.current = false;
        return;
      }
      onBeforeAction?.();
      dispatchCreate(draggable, event.nativeEvent);
    },
  };
}
