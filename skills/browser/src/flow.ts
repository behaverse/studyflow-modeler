import type { Element, StudyModel, Value } from '@core/model/index';

export type FlowNode = {
  id: string;
  /** The BPMN element the step is (`bpmn:UserTask`); its schema type is `extensionType`. */
  type: string;
  extensionType?: string;
  /** The step as the study holds it: what the file says of it, its schema type's attributes among it. A run reads it,
   * never writes it. */
  element: Element;
  /** The study the step is in, for what the element refers to by id (`model.get`) and where it sits. */
  model: StudyModel;
  /** What the step reads: the `studyflow:Parameters` wired into it, merged; empty when none is. */
  parameters: Record<string, unknown>;
  outgoing: string[];
  incoming: string[];
};

export type SequenceFlow = {
  id: string;
  sourceId: string;
  targetId: string;
  element: Element;
};

/** What the step holds under `name`: its own value, else its schema entry's, else the default its schema declares. */
export function attributeOf(node: FlowNode, name: string): Value | undefined {
  return node.model.attributeOrDefault(node.element, name);
}

export function readString(node: FlowNode, name: string): string | undefined {
  const value = attributeOf(node, name);
  return typeof value === 'string' && value ? value : undefined;
}
