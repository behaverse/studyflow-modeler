import type { FontPatch, StudyResult } from '@canvas/index.ts';
import { newShape } from '@modeler/palette/newShape';
import { swapChoreographyInitiator } from '@modeler/shape/choreographyParticipants';
import type { Editor } from '@modeler/editor/port';

/* Every command here names its elements by id, as the study's verbs do. */

export type SetColorCommand = {
  type: 'SetColor';
  ids: string[];
  color: { fill?: string; stroke?: string };
};

/** A caption paints in its owner's colour, so colouring a label colours the element it names. */
export function runSetColor(modeler: Editor, command: SetColorCommand): void {
  modeler.study.style({ ids: command.ids, ...command.color });
}

export type SetFontCommand = {
  type: 'SetFont';
  ids: string[];
  font: FontPatch;
};

/** Restyle captions (weight, slant, alignment, ink); a label restyles the element it names. */
export function runSetFont(modeler: Editor, command: SetFontCommand): void {
  modeler.study.style({ ids: command.ids, font: command.font });
}

export type DeleteElementsCommand = {
  type: 'DeleteElements';
  ids: string[];
};

/** Delete the elements and their closure (contents, incident edges), as one edit. */
export function runDeleteElements(modeler: Editor, command: DeleteElementsCommand): StudyResult {
  return modeler.study.remove({ ids: command.ids });
}

export type ReplaceElementCommand = {
  type: 'ReplaceElement';
  id: string;
  bpmnType: string;
  extensionType?: string;
  attributes?: Record<string, unknown>;
};

/** Retype the selected shape in place, keeping its name, position and flows, and select it: its new id, when it took. */
export function runReplaceElement(modeler: Editor, command: ReplaceElementCommand): string | undefined {
  const { id } = modeler.study.replace({ id: command.id, ...newShape(command.bpmnType, command.extensionType, command.attributes) });
  if (id !== undefined) modeler.selection.select(id);
  return id;
}

export type SwapChoreographyInitiatorCommand = {
  type: 'SwapChoreographyInitiator';
  id: string;
};

export function runSwapChoreographyInitiator(modeler: Editor, command: SwapChoreographyInitiatorCommand): void {
  const task = modeler.study.businessObject(command.id);
  if (task) modeler.study.edit(command.id, (writer) => swapChoreographyInitiator(task, writer));
}

export type ToggleDefaultFlowCommand = {
  type: 'ToggleDefaultFlow';
  id: string;
};

/** Mark a sequence flow as its source's `default`, or unmark it. The slash moves, never multiplies. */
export function runToggleDefaultFlow(modeler: Editor, command: ToggleDefaultFlowCommand): void {
  const { study } = modeler;
  const flow = study.get(command.id);
  if (flow?.kind !== 'edge' || flow.source === undefined) return;
  const source: any = study.businessObject(flow.source);
  const flowObject = study.businessObject(flow.id);
  study.edit(flow.id, (writer) => writer.set(source, {
    default: source.default === flowObject ? undefined : flowObject,
  }));
}

export type StartConnectCommand = {
  type: 'StartConnect';
  from: string;
  event?: MouseEvent | any;
};

export function runStartConnect(modeler: Editor, command: StartConnectCommand): boolean {
  return modeler.canvas.startConnect(command.from, command.event);
}

export type ToggleExpandedCommand = {
  type: 'ToggleExpanded';
  id: string;
};

export function runToggleExpanded(modeler: Editor, command: ToggleExpandedCommand): boolean {
  const { study } = modeler;
  return (study.get(command.id)?.expanded === false ? study.expand({ id: command.id }) : study.collapse({ id: command.id })).ok;
}

export type DrillDownCommand = {
  type: 'DrillDown';
  id: string;
};

/** Show only the contents of an expandable container; the breadcrumb trail leads back out. */
export function runDrillDown(modeler: Editor, command: DrillDownCommand): boolean {
  return modeler.canvas.setScope(command.id);
}
