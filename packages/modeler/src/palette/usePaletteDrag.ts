import {
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { executeCommand } from '@modeler/commandBus';
import type { AddWhat } from '@modeler/popup/commands';
import type { Editor } from '@modeler/editor/port';

/** Pointer travel (px) that separates a tap from a drag. */
export const DRAG_THRESHOLD = 3;

/** What a tool, a pin or an Add panel row makes: a shape, or a template's elements. */
export type PaletteDraggable = AddWhat;

/** Arm the canvas's create gesture with `what`: it follows the pointer from `event`, and a click (or the drag's end) drops it. */
export function startCreate(modeler: Editor, what: AddWhat, event: MouseEvent): void {
  if (what.template) {
    void executeCommand(modeler, { type: 'PaletteStartCreateTemplate', templateId: what.template, event });
    return;
  }
  void executeCommand(modeler, {
    type: 'PaletteStartCreate',
    bpmnType: what.bpmnType,
    event,
    attributes: what.attributes ?? {},
    extensionType: what.extensionType,
  });
}

export type PaletteDragHandlers = {
  onPointerDown: (draggable: PaletteDraggable, event: ReactPointerEvent) => void;
  onPointerMove: (draggable: PaletteDraggable, event: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onClick: (draggable: PaletteDraggable, event: ReactMouseEvent) => void;
};

export function usePaletteDrag(
  modeler: Editor,
  onBeforeAction?: () => void,
): PaletteDragHandlers {
  const pressedRef = useRef(false);
  const startedRef = useRef(false);
  /* Touch fingers jitter a pixel the instant they land; without a threshold every tap starts a dead drag. */
  const pressPosRef = useRef({ x: 0, y: 0 });

  const dispatchCreate = (draggable: PaletteDraggable, nativeEvent: MouseEvent) => startCreate(modeler, draggable, nativeEvent);

  return {
    onPointerDown: (_draggable, event) => {
      pressedRef.current = true;
      startedRef.current = false;
      pressPosRef.current = { x: event.clientX, y: event.clientY };
      event.preventDefault();
    },

    onPointerMove: (draggable, event) => {
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
