/**
 * Append-anything, as commands (P6b §3A).
 *
 * The bpmn backend gets this from `bpmn-js-create-append-anything`:
 * `autoPlace.append(element, shape)` on click, `create.start(...)` on drag. The
 * canvas has no `autoPlace` at all, so the click path is spelled out here — mint
 * the shape, place it one gap to the right of its source, connect the two — and
 * the drag path reuses `gestures.startCreate`, which is already backend-neutral
 * (it is what the palette drags with).
 *
 * Both run through the `EditorPort`, so nothing here is canvas-only; it is simply
 * that on the bpmn backend the plugin's popup gets there first.
 */

import { buildBusinessObject } from '@modeler/shape/buildBusinessObject';
import { getEditorPort } from '@modeler/editor/registry';
import type { EditorElement } from '@modeler/editor/port';
import type { PortHandle } from '@modeler/editor/registry';

/**
 * Horizontal gap between a source shape and the successor appended from it —
 * bpmn-js's `BpmnAutoPlaceUtil` default, so a click-append lands where a user of
 * the other backend expects it to.
 *
 * The canvas owns this number now (`@canvas/interaction/autoplace.ts`); it survives
 * here only for the fallback below, which runs on a backend that publishes no
 * `gestures.appendShape`.
 */
export const APPEND_DISTANCE = 50;

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
 * The backend does the placing when it can (`gestures.appendShape` — the canvas's
 * `interaction/autoplace.ts`, one undo step, and the same solver a future keyboard
 * or context-pad append would use). The fallback spells the same placement out over
 * two mutations for a backend that publishes no such gesture; it is deliberately
 * unclever — one fixed gap to the right, vertically centred on the source — and
 * unlike bpmn-js's `AutoPlace` it does not nudge when the slot is occupied, so
 * appending twice from one element stacks the successors.
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

  const created = editor.gestures.appendShape
    ? editor.gestures.appendShape(source, shape)
    : appendByHand(editor, source, shape);
  if (!created) return undefined;

  // The backend selects (and may open the label editor on) whatever it just
  // created; re-selecting would be a no-op there and would close that editor on a
  // backend that behaved differently. Only select when nobody already did.
  if (editor.selection.get()[0] !== created) editor.selection.select(created);

  return created;
}

/** The two-mutation stand-in for a backend without `gestures.appendShape`. */
function appendByHand(
  editor: ReturnType<typeof getEditorPort>,
  source: EditorElement,
  shape: EditorElement,
): EditorElement | undefined {
  const parent = source.parent ?? editor.elements.findRoot(source) ?? editor.elements.root();
  const created = editor.mutate.createShape(
    shape,
    {
      x: source.x + source.width + APPEND_DISTANCE + (shape.width ?? 0) / 2,
      y: source.y + source.height / 2,
    },
    parent,
  );
  if (!created) return undefined;
  editor.mutate.createConnection(source, created, { type: 'bpmn:SequenceFlow' }, parent);
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
 * backend to draw the connection on drop.
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
  editor.gestures.primeHover?.(command.event);

  return shape;
}
