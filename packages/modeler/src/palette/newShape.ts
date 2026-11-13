import type { NewShape } from '@canvas/index.ts';

/** The shape a palette or menu entry adds, in the form the study takes: its BPMN type, the schema type extending it, its attributes. */
export function newShape(bpmnType: string, extensionType?: string, attributes?: Record<string, unknown>): NewShape {
  return {
    type: bpmnType,
    ...(extensionType ? { extension: extensionType } : {}),
    ...(attributes && Object.keys(attributes).length > 0 ? { attributes } : {}),
  };
}
