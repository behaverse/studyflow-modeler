/**
 * Append-anything, as commands. A click asks the canvas to place the new element
 * beside its source and connect it; a drag reuses the palette's create gesture.
 */

import { buildBusinessObject } from '@modeler/palette/build';
import { APPEND_MENU, openPopupMenu } from '@modeler/editor/popupMenus';
import { t } from '@modeler/i18n';
import type { Editor, EditorElement } from '@modeler/editor/port';

/** A boundary event needs an explicit host, so it can never be auto-placed. */
export function mustDragToAppend(bpmnType: string): boolean {
  return bpmnType === 'bpmn:BoundaryEvent';
}

export type AppendElementCommand = {
  type: 'AppendElement';
  source: EditorElement;
  bpmnType: string;
  extensionType?: string;
  attributes?: Record<string, unknown>;
};

export function runAppendElement(modeler: Editor, command: AppendElementCommand): EditorElement | undefined {
  const source = modeler.canvas.resolveElement(command.source);
  if (!source || source.kind === 'label') return undefined;
  const businessObject = buildBusinessObject(modeler.model, command.bpmnType, {
    attributes: command.attributes,
    extensionType: command.extensionType,
  });
  const shape = modeler.canvas.createShape({ type: command.bpmnType, businessObject });
  const created = modeler.canvas.appendElement(source, shape);
  if (!created) return undefined;
  // The canvas selects (and may open the label editor on) what it created; only select when nobody did.
  if (modeler.selection.get()[0] !== created) modeler.selection.select(created);
  return created;
}

export type StartAppendElementCommand = {
  type: 'StartAppendElement';
  source: EditorElement;
  bpmnType: string;
  extensionType?: string;
  attributes?: Record<string, unknown>;
  event: MouseEvent | any;
};

/** Drag-append: the same shape, placed by the user and left unconnected. */
export function runStartAppendElement(modeler: Editor, command: StartAppendElementCommand): EditorElement {
  const businessObject = buildBusinessObject(modeler.model, command.bpmnType, {
    attributes: command.attributes,
    extensionType: command.extensionType,
  });
  const shape = modeler.canvas.createShape({ type: command.bpmnType, businessObject });
  modeler.canvas.startCreate(command.event, shape);
  return shape;
}

export type OpenAppendMenuCommand = {
  type: 'OpenAppendMenu';
  elements: EditorElement[];
};

/** The canvas's `a` key (a bus command, since the canvas cannot import the modeler): the append menu, beside the first element. */
export function runOpenAppendMenu(modeler: Editor, command: OpenAppendMenuCommand): void {
  const element = command.elements[0];
  if (!element) return;
  const box = modeler.canvas.getAbsoluteBBox(element);
  const x = box.x + box.width + 12;
  openPopupMenu(APPEND_MENU, { x, y: box.y, cursor: { x, y: box.y + box.height / 2 } }, { title: t('Append element') });
}
