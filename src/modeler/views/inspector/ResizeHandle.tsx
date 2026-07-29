import { useCallback, type KeyboardEvent, type PointerEvent } from 'react';
import { clampPanelWidth, DEFAULT_PANEL_WIDTH } from '@/modeler/models/inspector/panelWidth';
import { inspector as s } from '@/modeler/infra/styles';

const KEYBOARD_STEP = 24;

type Props = {
  width: number;
  onResize: (width: number) => void;
  /** End of a gesture — where the width is worth remembering. */
  onCommit: (width: number) => void;
};

/**
 * The inspector's left edge, as a grab handle.
 *
 * The panel is anchored to the right, so dragging the edge left widens it —
 * pointer movement maps to width by subtraction, not by position. It sits
 * outside the panel's scroll box so it spans the full height whatever the
 * fields inside are doing, and it resizes on arrow keys too: a 6px strip is
 * a hard target to hit without a mouse.
 */
export function ResizeHandle({ width, onResize, onCommit }: Props) {
  const startDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;

    // The pointer leaves the 6px strip the moment it moves, so the gesture is
    // tracked on the window and ends wherever the release happens.
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      latest = clampPanelWidth(startWidth + (startX - moveEvent.clientX), window.innerWidth);
      onResize(latest);
    };
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      document.body.classList.remove('resizing-inspector');
      onCommit(latest);
    };

    document.body.classList.add('resizing-inspector');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }, [width, onResize, onCommit]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowLeft' ? width + KEYBOARD_STEP
      : event.key === 'ArrowRight' ? width - KEYBOARD_STEP
        : event.key === 'Home' ? DEFAULT_PANEL_WIDTH
          : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onCommit(clampPanelWidth(next, window.innerWidth));
  };

  return (
    <div
      data-testid="inspector-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize inspector"
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={startDrag}
      onDoubleClick={() => onCommit(DEFAULT_PANEL_WIDTH)}
      onKeyDown={onKeyDown}
      className={s.resizeHandle}
    />
  );
}
