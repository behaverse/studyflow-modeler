import { setExpressionLanguage } from '@/core/extensions';

export type UpdateExpressionLanguageCommand = {
  type: 'update-expression-language';
  element: any;
  /** The expression attribute the language rides on (e.g. `bpmn:conditionExpression`). */
  attributeName: string;
  /** `python` / `javascript`, or undefined for "the evaluating engine's own". */
  language: string | undefined;
};

/** Set the per-expression `language` — BPMN's own FormalExpression field.
 *  Never validated here: only the engine that evaluates the expression
 *  checks it, at run time. */
export function runUpdateExpressionLanguage(
  modeler: any,
  command: UpdateExpressionLanguageCommand,
): void {
  setExpressionLanguage(command.element, command.attributeName, command.language, modeler.get('modeling'));
}
