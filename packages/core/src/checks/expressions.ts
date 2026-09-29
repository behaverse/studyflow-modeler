import type { ModdleElement } from '@core/element/moddle';
import type { Issue } from '@core/checks';
import { PLACEHOLDER } from '@core/document/state';
import { feelSyntaxError } from '@core/expression/feel';

/**
 * Every expression a study writes is FEEL, in both runtimes (packages/core/src/expression/feel.ts): a flow's
 * condition, a loop's condition or cardinality, a conditional event's condition, a data edge's selection. One that
 * does not parse as FEEL, or names another language, is an error before any run. A `{placeholder}` reads as the path
 * it names, as the runtimes read it.
 */
export function checkExpressions(definitions: ModdleElement): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<unknown>();
  const visit = (element: ModdleElement, owner?: string): void => {
    if (!element || typeof element !== 'object' || seen.has(element)) return;
    seen.add(element);
    const id = typeof element.id === 'string' ? element.id : owner;
    if (element.$instanceOf?.('bpmn:Expression') && typeof element.body === 'string' && element.body.trim()) {
      const language: unknown = element.language;
      const body = element.body.trim().replace(PLACEHOLDER, (_match: string, path: string) => path);
      const error = typeof language === 'string' && language && !language.toLowerCase().includes('feel')
        ? `names ${language}, and every Studyflow expression is FEEL`
        : feelSyntaxError(body);
      if (error) issues.push({ severity: 'error', elementId: id, message: `the expression ${JSON.stringify(element.body.trim())} on ${JSON.stringify(id)} ${error.startsWith('not FEEL') ? `is ${error}` : error}` });
    }
    for (const property of element.$descriptor?.properties ?? []) {
      if (property.isReference) continue;
      const value = element[property.name];
      if (Array.isArray(value)) value.forEach((item) => visit(item, id));
      else if (value && typeof value === 'object' && '$type' in value) visit(value, id);
    }
  };
  visit(definitions);
  return issues;
}
