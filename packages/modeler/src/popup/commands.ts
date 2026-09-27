/**
 * Append-anything, as commands. A click asks the canvas to place the new element
 * beside its source and connect it; a drag reuses the palette's create gesture.
 */

import { newShape } from '@modeler/palette/newShape';
import { APPEND_MENU, openPopupMenu } from '@modeler/editor/popupMenus';
import { t } from '@modeler/i18n';
import type { Editor } from '@modeler/editor/port';

/** A boundary event needs an explicit host, so it can never be auto-placed. */
export function mustDragToAppend(bpmnType: string): boolean {
  return bpmnType === 'bpmn:BoundaryEvent';
}

export type AppendElementCommand = {
  type: 'AppendElement';
  from: string;
  bpmnType: string;
  extensionType?: string;
  attributes?: Record<string, unknown>;
};

/** Click-append: the canvas places the shape beside `from`, connects the two, selects it and opens its name; its id. */
export function runAppendElement(modeler: Editor, command: AppendElementCommand): string | undefined {
  return modeler.canvas.append(command.from, newShape(command.bpmnType, command.extensionType, command.attributes)).id;
}

export type StartAppendElementCommand = {
  type: 'StartAppendElement';
  bpmnType: string;
  extensionType?: string;
  attributes?: Record<string, unknown>;
  event: MouseEvent | any;
};

/** Drag-append: the same shape, placed by the user and left unconnected. */
export function runStartAppendElement(modeler: Editor, command: StartAppendElementCommand): boolean {
  return modeler.canvas.startCreate(command.event, newShape(command.bpmnType, command.extensionType, command.attributes));
}

export type OpenAppendMenuCommand = {
  type: 'OpenAppendMenu';
  ids: string[];
};

/** The canvas's `a` key, forwarded by `editor/mount.ts`: the append menu, beside the first element. */
export function runOpenAppendMenu(modeler: Editor, command: OpenAppendMenuCommand): void {
  const box = command.ids[0] === undefined ? undefined : modeler.canvas.screenBox(command.ids[0]);
  if (!box) return;
  const x = box.x + box.width + 12;
  openPopupMenu(APPEND_MENU, { x, y: box.y, cursor: { x, y: box.y + box.height / 2 } }, { title: t('Append element') });
}
