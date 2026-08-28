/**
 * Append-anything, as commands (P6b §3A).
 *
 * Two routes out of the append menu: a click, which asks the editor to place the
 * new element itself (`mutate.appendShape` — one gap to the right of its source,
 * connected, as one undo step), and a drag, which reuses the canvas's create
 * gesture and lets the user place it (the same gesture the palette drags with).
 *
 * Both run through the `Editor`; this module only mints the business object
 * and picks the route.
 */

import { buildBusinessObject } from '@canvas/model/build.ts';
import type { Editor, EditorElement } from '@modeler/editor/port';

/** Whether `element` may be appended from at all (`rules.allowed('shape.append')`). */
export function canAppendFrom(modeler: Editor, element: EditorElement | undefined): boolean {
  if (!element) return false;
  // The canvas rule reads `source ?? element ?? shape`; both keys are sent because
  // the rule vocabulary is shared with the schema rules, which name `element`.
  return modeler.rules.allowed('shape.append', { element, source: element });
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
 * The editor does the placing (`mutate.appendShape` — the canvas's
 * `interaction/autoplace.ts`, one undo step, and the same solver the keyboard's
 * `a` and the context pad's append entries use).
 */
export function runAppendElement(
  modeler: Editor,
  command: AppendElementCommand,
): EditorElement | undefined {
  const { source } = command;
  if (!source) return undefined;

  const businessObject = buildBusinessObject(modeler.model, command.bpmnType, {
    attributes: command.attributes,
    extensionType: command.extensionType,
  });
  const shape = modeler.canvas.createShape({ type: command.bpmnType, businessObject });

  const created = modeler.mutate.appendShape(source, shape);
  if (!created) return undefined;

  // The editor selects (and may open the label editor on) whatever it just
  // created; re-selecting would close that editor. Only select when nobody did.
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

/**
 * Drag-append: the same shape, but the user places it — identical to
 * `runPaletteStartCreate`.
 */
export function runStartAppendElement(
  modeler: Editor,
  command: StartAppendElementCommand,
): EditorElement {
  const businessObject = buildBusinessObject(modeler.model, command.bpmnType, {
    attributes: command.attributes,
    extensionType: command.extensionType,
  });
  const shape = modeler.canvas.createShape({ type: command.bpmnType, businessObject });

  // The `source` is NOT passed on: the canvas create gesture takes no source hint,
  // so a drag-append places the shape and leaves it unconnected. (The facade's old
  // `gestures.startCreate` accepted a `{ source }` context and dropped it on the
  // floor — same behaviour, now visible.)
  modeler.canvas.startCreate(command.event, shape);

  return shape;
}
