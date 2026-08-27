import { swapChoreographyInitiator } from '@modeler/shape/choreographyParticipants';
import type { EditorElement, Editor } from '@modeler/editor/port';

export type SetColorCommand = {
  type: 'SetColor';
  elements: any[];
  color: { fill?: string; stroke?: string };
};

/**
 * A caption has no colour of its own: it is painted in the stroke of the element it
 * names, so the brush beside a selected label (`edge-videos/labels/frame_08`) paints
 * that element. bpmn-js resolves `labelTarget` the same way before colouring, and
 * without it the write lands on a `bpmndi:BPMNLabel` where nothing reads it back.
 */
function colorTarget(element: any): any {
  return element?.labelTarget ?? element;
}

export function runSetColor(modeler: Editor, command: SetColorCommand): void {
  const targets = command.elements.map(colorTarget);
  // De-duplicated: selecting an element and its own caption must not paint it twice.
  modeler.mutate.setColor([...new Set(targets)], command.color);
}


export type DeleteElementsCommand = {
  type: 'DeleteElements';
  elements: EditorElement[];
};

/**
 * The context pad's trash (parity spec addendum 4 / ux-spec §4 entry `delete`).
 *
 * Deletion has lived in the editor since P5 — the canvas answers `Delete`/`Backspace`
 * itself and closes the removal over contents and incident edges — so this is the
 * app-chrome doorway to that same closure, not a second implementation. Returns
 * everything actually removed.
 */
export function runDeleteElements(
  modeler: Editor,
  command: DeleteElementsCommand,
): EditorElement[] {
  const { elements } = command;
  if (!elements || elements.length === 0) return [];
  return modeler.mutate.removeElements(elements);
}


export type ReplaceElementCommand = {
  type: 'ReplaceElement';
  element: EditorElement;
  bpmnType: string;
  extensionType?: string;
};

/**
 * The context pad's wrench, "Change element" (ux-spec §4 entry 4): retype the
 * selected shape in place, keeping its name, its position and the flows that reach
 * it. One undo step, because the editor treats it as one mutation.
 *
 * Returns the replacement, or `undefined` when nothing happened — the rules refused
 * the swap, or the entry that was picked names the type the shape already is.
 */
export function runReplaceElement(
  modeler: Editor,
  command: ReplaceElementCommand,
): EditorElement | undefined {
  const { element, bpmnType, extensionType } = command;
  if (!element || !bpmnType) return undefined;
  return modeler.mutate.replaceShape(element, {
    type: bpmnType,
    ...(extensionType ? { extensionType } : {}),
  });
}


export type SwapChoreographyInitiatorCommand = {
  type: 'SwapChoreographyInitiator';
  element: EditorElement;
};

/**
 * Flip which participant band of a choreography task initiates — the studyflow
 * context-pad entry that the app has always contributed
 * (`contextPad/ContextPad.ts` under bpmn-js, ux-spec §4 "the app adds
 * `choreography.swap-initiator`"). The affordance died with the old pad; the helper
 * it called did not, so this is that helper reached through the facade.
 *
 * The two participants are materialized first when the task has none, which is why
 * this can be more than one `mutate` call — they land in one synchronous burst and
 * therefore in one history snapshot, exactly as the inspector's initiator dropdown
 * does.
 */
export function runSwapChoreographyInitiator(
  modeler: Editor,
  command: SwapChoreographyInitiatorCommand,
): void {
  const { mutate, model } = modeler;
  swapChoreographyInitiator(command.element, mutate, { create: model.createBusinessObject });
}


export type StartConnectCommand = {
  type: 'StartConnect';
  source: EditorElement;
  event?: MouseEvent | any;
};

/**
 * The context pad's connect entry (parity spec addendum 4 §1): a connection drag
 * that starts from the pad rather than from the palette, with the editor's own live
 * preview following the pointer. Returns whether the gesture started.
 */
export function runStartConnect(modeler: Editor, command: StartConnectCommand): boolean {
  // Only a NODE can start a connection drag; a stale or off-plane reference, or a
  // connection, simply does not start one.
  const source = modeler.canvas.resolveElement(command.source);
  if (!source || source.kind !== 'node') return false;
  return modeler.canvas.startConnect(source, command.event);
}
