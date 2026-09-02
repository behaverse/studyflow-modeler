import { swapChoreographyInitiator } from '@modeler/shape/choreographyParticipants';
import type { EditorElement, Editor } from '@modeler/editor/port';

export type SetColorCommand = {
  type: 'SetColor';
  elements: any[];
  color: { fill?: string; stroke?: string };
};

/** A caption paints in its owner's colour, so colouring a label colours the element it names. */
export function runSetColor(modeler: Editor, command: SetColorCommand): void {
  modeler.canvas.setColor(command.elements, command.color);
}

export type DeleteElementsCommand = {
  type: 'DeleteElements';
  elements: EditorElement[];
};

/** Delete the elements and their closure (contents, incident edges). Returns what was removed. */
export function runDeleteElements(modeler: Editor, command: DeleteElementsCommand): EditorElement[] {
  const elements = (command.elements ?? [])
    .map((element) => modeler.canvas.resolveElement(element))
    .filter((element): element is NonNullable<typeof element> => !!element);
  if (elements.length === 0) return [];
  return modeler.canvas.deleteElements(elements);
}

export type ReplaceElementCommand = {
  type: 'ReplaceElement';
  element: EditorElement;
  bpmnType: string;
  extensionType?: string;
  attributes?: Record<string, unknown>;
};

/** Retype the selected shape in place, keeping its name, position and flows. */
export function runReplaceElement(modeler: Editor, command: ReplaceElementCommand): EditorElement | undefined {
  const node = modeler.canvas.resolveElement(command.element);
  if (!node || node.kind !== 'node' || !command.bpmnType) return undefined;
  return modeler.canvas.replaceElement(node, {
    type: command.bpmnType,
    ...(command.extensionType ? { extensionType: command.extensionType } : {}),
    ...(command.attributes ? { attrs: command.attributes } : {}),
  });
}

export type SwapChoreographyInitiatorCommand = {
  type: 'SwapChoreographyInitiator';
  element: EditorElement;
};

export function runSwapChoreographyInitiator(modeler: Editor, command: SwapChoreographyInitiatorCommand): void {
  swapChoreographyInitiator(command.element, modeler.canvas, { create: modeler.model.createBusinessObject });
}

export type ToggleDefaultFlowCommand = {
  type: 'ToggleDefaultFlow';
  element: EditorElement;
};

/** Mark a sequence flow as its source's `default`, or unmark it. The slash moves, never multiplies. */
export function runToggleDefaultFlow(modeler: Editor, command: ToggleDefaultFlowCommand): void {
  const flow = modeler.canvas.resolveElement(command.element);
  if (!flow || flow.kind !== 'edge' || !flow.source?.businessObject) return;
  const sourceBo = flow.source.businessObject as { default?: unknown };
  const previous = flow.source.outgoing.find((edge) => edge !== flow && edge.businessObject === sourceBo.default);
  modeler.canvas.updateModdleProperties(flow, flow.source.businessObject, {
    default: sourceBo.default === flow.businessObject ? undefined : flow.businessObject,
  });
  modeler.canvas.redrawElements(previous ? [flow, previous] : [flow]);
}

export type StartConnectCommand = {
  type: 'StartConnect';
  source: EditorElement;
  event?: MouseEvent | any;
};

export function runStartConnect(modeler: Editor, command: StartConnectCommand): boolean {
  const source = modeler.canvas.resolveElement(command.source);
  if (!source || source.kind !== 'node') return false;
  return modeler.canvas.startConnect(source, command.event);
}

export type ToggleExpandedCommand = {
  type: 'ToggleExpanded';
  element: EditorElement;
};

export function runToggleExpanded(modeler: Editor, command: ToggleExpandedCommand): boolean {
  const node = modeler.canvas.resolveElement(command.element);
  if (!node || node.kind !== 'node' || !modeler.canvas.canExpand(node)) return false;
  return modeler.canvas.toggleExpanded(node);
}

export type DrillDownCommand = {
  type: 'DrillDown';
  element: EditorElement;
};

/** Show only the contents of an expandable container; the breadcrumb trail leads back out. */
export function runDrillDown(modeler: Editor, command: DrillDownCommand): boolean {
  const node = modeler.canvas.resolveElement(command.element);
  if (!node || node.kind !== 'node') return false;
  return modeler.canvas.enterScope(node);
}
