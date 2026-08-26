/**
 * The affordance that opens the append and colour menus (P6b §3A, §3B).
 *
 * These were plugin-owned context-pad entries while bpmn-js was the editor
 * (`bpmn-js-create-append-anything`'s `append`, `bpmn-js-color-picker`'s
 * `set-color`), floated beside the selection by diagram-js. The canvas has no
 * context pad, so the app floats its own two-button bar above the selection and
 * opens the two menu ids through `EditorPort.popup` — which is exactly the seam
 * `PopupMenus.tsx` registers against.
 *
 * Positioning runs on an animation frame rather than an event, because the canvas
 * publishes no viewbox-changed topic: a pan, a zoom and a drag of the selected
 * shape all have to move the bar, and one cheap bbox read per frame (only while
 * something is selected) is simpler than instrumenting three gestures.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { getEditorPort } from '@modeler/editor/registry';
import { canAppendFrom } from '@modeler/popup/commands';
import { APPEND_MENU, COLOR_MENU } from '@modeler/popup/PopupMenus';
import { useIsSimulating } from '@modeler/simulation/useIsSimulating';
import { selectionToolbar as s } from '@modeler/popup/styles';
import { t } from '@modeler/i18n';
import { ICONS } from '@modeler/icons';
import type { EditorElement, EditorPort, Rect } from '@modeler/editor/port';

/** Gap between the selection's right edge and the strip — diagram-js's own. */
const OFFSET = 12;

function selectionBBox(editor: EditorPort, elements: EditorElement[]): Rect | undefined {
  let box: Rect | undefined;
  for (const element of elements) {
    let next: Rect;
    try {
      next = editor.view.getAbsoluteBBox(element);
    } catch {
      // Off-plane elements throw rather than answer; skip them.
      continue;
    }
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) continue;
    if (!box) {
      box = { ...next };
      continue;
    }
    const right = Math.max(box.x + box.width, next.x + next.width);
    const bottom = Math.max(box.y + box.height, next.y + next.height);
    box.x = Math.min(box.x, next.x);
    box.y = Math.min(box.y, next.y);
    box.width = right - box.x;
    box.height = bottom - box.y;
  }
  return box;
}

export function SelectionToolbar() {
  const modeler = useRequiredModeler();
  const isSimulating = useIsSimulating(modeler);
  const [elements, setElements] = useState<EditorElement[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = getEditorPort(modeler);
    const sync = (): void => setElements(editor.selection.get());
    sync();
    editor.events.on('selection.changed', sync);
    editor.events.on('root.set', sync);
    editor.events.on('import.done', sync);
    return () => {
      editor.events.off('selection.changed', sync);
      editor.events.off('root.set', sync);
      editor.events.off('import.done', sync);
    };
  }, [modeler]);

  const visible = !isSimulating && elements.length > 0;

  /* Written straight to the node: a pan is 60 position changes a second, and none
     of them is a React state change. */
  useEffect(() => {
    if (!visible) return;
    const editor = getEditorPort(modeler);
    let frame = 0;
    let last = '';

    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      const node = ref.current;
      if (!node) return;
      const box = selectionBBox(editor, elements);
      if (!box) {
        node.style.visibility = 'hidden';
        return;
      }
      const left = Math.round(Math.max(4, Math.min(box.x + box.width + OFFSET, window.innerWidth - node.offsetWidth - 4)));
      const top = Math.round(Math.max(4, Math.min(box.y, window.innerHeight - node.offsetHeight - 4)));
      const next = `${left},${top}`;
      if (next === last) return;
      last = next;
      node.style.transform = `translate(${left}px, ${top}px)`;
      node.style.visibility = 'visible';
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [modeler, visible, elements]);

  const openMenu = useCallback((providerId: string) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const anchor = { x: Math.round(rect.right + 6), y: Math.round(rect.top) };
    getEditorPort(modeler).popup.open(
      providerId,
      { ...anchor, cursor: { ...anchor } },
      { title: providerId === APPEND_MENU ? t('Append element') : t('Set color'), width: 260 },
    );
  }, [modeler]);

  if (!visible) return null;

  const canAppend = elements.length === 1 && canAppendFrom(modeler, elements[0]);

  return (
    <div
      ref={ref}
      className={s.root}
      style={{ visibility: 'hidden' }}
      data-testid="selection-toolbar"
      role="toolbar"
      aria-label="Selected element actions"
    >
      <button
        type="button"
        className={s.button}
        title="Append element"
        aria-label="Append element"
        data-testid="selection-append"
        disabled={!canAppend}
        onClick={() => openMenu(APPEND_MENU)}
      >
        <span className={`${ICONS.arrowRight} ${s.buttonIcon}`} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={s.button}
        title="Set color"
        aria-label="Set color"
        data-testid="selection-color"
        onClick={() => openMenu(COLOR_MENU)}
      >
        <span className={`${ICONS.palette} ${s.buttonIcon}`} aria-hidden="true" />
      </button>
    </div>
  );
}
