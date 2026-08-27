/**
 * Append-anything, as commands (P6b §3A).
 *
 * Two routes out of the append menu: a click, which asks the editor to place the
 * new element itself (`gestures.appendShape` — one gap to the right of its source,
 * connected, as one undo step), and a drag, which reuses `gestures.startCreate`
 * and lets the user place it (the same gesture the palette drags with).
 *
 * Both run through the `EditorPort`; this module only mints the business object
 * and picks the route.
 */

import { buildBusinessObject } from '@modeler/shape/buildBusinessObject';
import { getEditorPort } from '@modeler/editor/registry';
import type { EditorElement } from '@modeler/editor/port';
import type { PortHandle } from '@modeler/editor/registry';

/** Whether `element` may be appended from at all (`rules.allowed('shape.append')`). */
export function canAppendFrom(modeler: PortHandle, element: EditorElement | undefined): boolean {
  if (!element) return false;
  // The canvas rule reads `source ?? element ?? shape`; both keys are sent because
  // the rule vocabulary is shared with the schema rules, which name `element`.
  return getEditorPort(modeler).rules.allowed('shape.append', { element, source: element });
}

/**
 * A boundary event needs an explicit host, so it can never be auto-placed: the
 * user has to drag it onto the activity it attaches to.
 */
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

/**
 * Click-append: place a new `bpmnType` beside `source` and connect them.
 *
 * The editor does the placing (`gestures.appendShape` — the canvas's
 * `interaction/autoplace.ts`, one undo step, and the same solver the keyboard's
 * `a` and the context pad's append entries use).
 */
export function runAppendElement(
  modeler: PortHandle,
  command: AppendElementCommand,
): EditorElement | undefined {
  const editor = getEditorPort(modeler);
  const { source } = command;
  if (!source) return undefined;

  const businessObject = buildBusinessObject(editor.model, command.bpmnType, {
    attributes: command.attributes,
    extensionType: command.extensionType,
  });
  const shape = editor.gestures.createShape({ type: command.bpmnType, businessObject });

  const created = editor.gestures.appendShape(source, shape);
  if (!created) return undefined;

  // The editor selects (and may open the label editor on) whatever it just
  // created; re-selecting would close that editor. Only select when nobody did.
  if (editor.selection.get()[0] !== created) editor.selection.select(created);

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

/**
 * Drag-append: the same shape, but the user places it. Identical to
 * `runPaletteStartCreate` except for the `source` hint, which is what tells the
 * editor to draw the connection on drop.
 */
export function runStartAppendElement(
  modeler: PortHandle,
  command: StartAppendElementCommand,
): EditorElement {
  const editor = getEditorPort(modeler);
  const businessObject = buildBusinessObject(editor.model, command.bpmnType, {
    attributes: command.attributes,
    extensionType: command.extensionType,
  });
  const shape = editor.gestures.createShape({ type: command.bpmnType, businessObject });

  editor.gestures.startCreate(command.event, shape, { source: command.source });

  return shape;
}
