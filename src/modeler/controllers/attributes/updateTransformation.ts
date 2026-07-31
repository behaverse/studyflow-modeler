import { toBusinessObject } from '@/core/extensions';

export type UpdateTransformationCommand = {
  type: 'update-transformation';
  /** The selected data-association connection. */
  element: any;
} & (
  | { field: 'body'; value: string }
  | { field: 'language'; value: string | undefined }
);

/**
 * Edit the selected wire's own `transformation` — BPMN's native expression
 * element on the association, used as-is. The body holds the compact
 * `slot = selection` grammar; `language` is the element's own per-expression
 * field, validated only by the engine that eventually evaluates it.
 */
export function runUpdateTransformation(modeler: any, command: UpdateTransformationCommand): void {
  const modeling = modeler.get('modeling');
  const association = toBusinessObject(command.element);
  const expression = association.get?.('transformation') ?? association.transformation;

  if (command.field === 'language') {
    if (expression) modeling.updateModdleProperties(command.element, expression, { language: command.value || undefined });
    return;
  }

  const body = command.value.trim();
  if (!body) {
    modeling.updateModdleProperties(command.element, association, { transformation: undefined });
  } else if (expression) {
    modeling.updateModdleProperties(command.element, expression, { body });
  } else {
    const created = modeler.get('moddle').create('bpmn:FormalExpression', { body });
    created.$parent = association;
    modeling.updateModdleProperties(command.element, association, { transformation: created });
  }
}
