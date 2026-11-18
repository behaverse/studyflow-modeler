/**
 * The commands the Add panel (`addMenu.ts`) runs where it adds in place, and the three that open it there: after the
 * selection (the `a` key), on a flow (its +), and at a point on the canvas (a double-click on its background). A drag
 * out of the panel is the tools' create gesture (`PaletteStartCreate`).
 */

import { newShape } from '@modeler/palette/newShape';
import { ADD_HERE_MENU, APPEND_MENU, INSERT_MENU, openPopupMenu } from '@modeler/editor/popupMenus';
import type { NewElement } from '@canvas/index.ts';
import type { Editor } from '@modeler/editor/port';

/** A boundary event needs an explicit host, so it can never be auto-placed. */
export function mustDragToAppend(bpmnType: string): boolean {
  return bpmnType === 'bpmn:BoundaryEvent';
}

/** What an Add panel entry adds: a shape, or a template's elements. */
export type AddWhat = {
  bpmnType: string;
  extensionType?: string;
  attributes?: Record<string, unknown>;
  /** A template's id, in place of the shape. */
  template?: string;
};

function elementOf(what: AddWhat): NewElement {
  return what.template ? { template: what.template } : newShape(what.bpmnType, what.extensionType, what.attributes);
}

export type AppendElementCommand = AddWhat & {
  type: 'AppendElement';
  from: string;
};

/** Click-append: the canvas places the shape beside `from`, connects the two, selects it and opens its name. Returns its id. */
export function runAppendElement(modeler: Editor, command: AppendElementCommand): string | undefined {
  return modeler.canvas.append(command.from, elementOf(command)).id;
}

export type InsertElementCommand = AddWhat & {
  type: 'InsertElement';
  /** The sequence flow it goes on. */
  into: string;
};

/** Click-insert: the canvas puts the shape on the flow, between its ends, selects it and opens its name. Returns its id. */
export function runInsertElement(modeler: Editor, command: InsertElementCommand): string | undefined {
  return modeler.canvas.insert(command.into, elementOf(command)).id;
}

export type AddElementAtCommand = AddWhat & {
  type: 'AddElementAt';
  /** Where it lands, on screen (client coordinates): its centre. */
  at: { x: number; y: number };
};

/** Put the shape where the canvas was double-clicked, into what is under that point, as a drop there does. */
export function runAddElementAt(modeler: Editor, command: AddElementAtCommand): boolean {
  return modeler.canvas.addAt(elementOf(command), command.at);
}

export type OpenAppendMenuCommand = {
  type: 'OpenAppendMenu';
  ids: string[];
};

/** The canvas's `a` key, forwarded by `editor/mount.ts`: the Add panel beside the first element, appending to it. */
export function runOpenAppendMenu(modeler: Editor, command: OpenAppendMenuCommand): void {
  const box = command.ids[0] === undefined ? undefined : modeler.canvas.screenBox(command.ids[0]);
  if (!box) return;
  const x = box.x + box.width + 12;
  openPopupMenu(APPEND_MENU, { x, y: box.y, cursor: { x, y: box.y + box.height / 2 } });
}

export type OpenInsertMenuCommand = {
  type: 'OpenInsertMenu';
  /** The flow whose + was pressed. */
  edge: string;
  at: { x: number; y: number };
};

/** A press on a flow's +, forwarded by `editor/mount.ts`: the Add panel there, putting a step on the flow. */
export function runOpenInsertMenu(_modeler: Editor, command: OpenInsertMenuCommand): void {
  openPopupMenu(INSERT_MENU, { ...command.at, cursor: { ...command.at } }, { subject: command.edge });
}

export type OpenAddMenuCommand = {
  type: 'OpenAddMenu';
  /** The point double-clicked, on screen. */
  at: { x: number; y: number };
};

/** A double-click on the canvas's background, forwarded by `editor/mount.ts`: the Add panel there, adding there. */
export function runOpenAddMenu(_modeler: Editor, command: OpenAddMenuCommand): void {
  openPopupMenu(ADD_HERE_MENU, { ...command.at, cursor: { ...command.at } });
}
