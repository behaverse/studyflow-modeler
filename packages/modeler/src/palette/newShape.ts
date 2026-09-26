import type { NewShape } from '@canvas/index.ts';

/** What a palette or menu entry adds, as the study takes it: its BPMN type, the schema type extending it, its attributes. */
export function newShape(bpmnType: string, extensionType?: string, attributes?: Record<string, unknown>): NewShape {
  return {
    type: bpmnType,
    ...(extensionType ? { extension: extensionType } : {}),
    ...(attributes && Object.keys(attributes).length > 0 ? { attributes } : {}),
  };
}
