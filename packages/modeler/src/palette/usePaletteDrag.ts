import {
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { executeCommand } from '@modeler/commandBus';
import type { PaletteEntry } from '@modeler/palette/groups';
import type { PaletteTemplate } from '@modeler/palette/commands';
import type { Editor } from '@modeler/editor/port';

/** Pointer travel (px) that separates a tap from a drag. */
export const DRAG_THRESHOLD = 3;

export type PaletteDraggable = PaletteEntry | (PaletteTemplate & { __template: true });

export type PaletteDragHandlers = {
  onPointerDown: (draggable: PaletteDraggable, event: ReactPointerEvent) => void;
  onPointerMove: (draggable: PaletteDraggable, event: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onClick: (draggable: PaletteDraggable, event: ReactMouseEvent) => void;
};

function isTemplate(draggable: PaletteDraggable): draggable is PaletteTemplate & { __template: true } {
  return (draggable as any).__template === true;
}

export function usePaletteDrag(
  modeler: Editor,
  onBeforeAction?: () => void,
): PaletteDragHandlers {
  const pressedRef = useRef(false);
  const startedRef = useRef(false);
  /* Touch fingers jitter a pixel the instant they land; without a threshold every tap starts a dead drag. */
  const pressPosRef = useRef({ x: 0, y: 0 });

  const dispatchCreate = (draggable: PaletteDraggable, nativeEvent: MouseEvent) => {
    if (isTemplate(draggable)) {
      executeCommand(modeler, {
        type: 'PaletteStartCreateTemplate',
        templateId: draggable.id,
        event: nativeEvent,
      });
      return;
    }
    executeCommand(modeler, {
      type: 'PaletteStartCreate',
      bpmnType: draggable.bpmnType,
      event: nativeEvent,
      attributes: draggable.attributes ?? {},
      extensionType: draggable.extensionType,
    });
  };

  return {
    onPointerDown: (_draggable, event) => {
      pressedRef.current = true;
      startedRef.current = false;
      pressPosRef.current = { x: event.clientX, y: event.clientY };
      event.preventDefault();
    },

    onPointerMove: (draggable, event) => {
      if (!modeler) return;
      if (!pressedRef.current || startedRef.current) return;
      const { x, y } = pressPosRef.current;
      if (Math.hypot(event.clientX - x, event.clientY - y) < DRAG_THRESHOLD) return;
      startedRef.current = true;
      event.preventDefault();
      onBeforeAction?.();
      dispatchCreate(draggable, event.nativeEvent);
    },

    onPointerUp: () => {
      pressedRef.current = false;
    },

    onClick: (draggable, event) => {
      if (!modeler) return;
      event.preventDefault();
      if (startedRef.current) {
        startedRef.current = false;
        pressedRef.current = false;
        return;
      }
      onBeforeAction?.();
      dispatchCreate(draggable, event.nativeEvent);
    },
  };
}
