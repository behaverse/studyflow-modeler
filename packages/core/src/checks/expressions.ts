import type { Issue } from '@core/checks';
import { splitBinding } from '@core/document/io-specification';
import { timerDelay } from '@core/engine/timer';
import { feelSyntaxError } from '@core/expression/feel';
import { expressionOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index';

/** A timer's properties: ISO 8601 text (`P21D`), not FEEL. */
const TIMER = new Set(['timeDuration', 'timeDate', 'timeCycle']);

/**
 * Every expression a study writes is FEEL, in both runtimes (packages/core/src/expression/feel.ts): a flow's
 * condition, a loop's condition or cardinality, a conditional event's condition, a data edge's selection. One that
 * does not parse as FEEL, or names another language, is an error before any run. A `{placeholder}` reads as the path
 * it names, as the runtimes read it.
 */
export function checkExpressions(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  const check = (element: Element, value: Value): void => {
    const id = model.ownerOf(element);
    const expression = expressionOf(value);
    if (!expression) return;
    const language = isElement(value) ? value.language : undefined;
    // A data input's transformation is `slot = selection`: the slot (`self`, `*`, a name) is no expression.
    const text = model.isA(element, 'bpmn:DataInputAssociation') ? splitBinding(expression.body).selection ?? '' : expression.body;
    const body = text.trim();
    if (!body) return;
    const error = typeof language === 'string' && language && !language.toLowerCase().includes('feel')
      ? `names ${language}, and every Studyflow expression is FEEL`
      : feelSyntaxError(body);
    if (error) issues.push({ severity: 'error', elementId: id, message: `the expression ${JSON.stringify(expression.body)} on ${JSON.stringify(id)} ${error.startsWith('not FEEL') ? `is ${error}` : error}` });
  };
  for (const element of model.all()) {
    for (const [key, value] of Object.entries(element)) {
      const property = key === 'type' || value === undefined ? undefined : model.propertyAt(element, key);
      if (value === undefined || !property || property.isReference || TIMER.has(key) || !model.metamodel.isA(property.type, 'bpmn:Expression')) continue;
      for (const item of Array.isArray(value) ? value : [value]) check(element, item);
    }
    if (element.type !== 'bpmn:TimerEventDefinition') continue;
    // A timer's time is an ISO 8601 date, duration or cycle (`P21D`), not FEEL; one citing a `{placeholder}` is read
    // when the walk reaches it.
    const holder = model.parentOf(element);
    const event = holder ? model.ownerOf(holder) : model.ownerOf(element);
    const time = (name: string): string | undefined => expressionOf(element[name])?.body;
    const timer = { duration: time('timeDuration'), date: time('timeDate'), cycle: time('timeCycle') };
    const texts = Object.values(timer).filter((text): text is string => text !== undefined);
    try {
      if (texts.length === 0) throw new Error('a timer says when: a duration (PT5M), a date, or a cycle');
      if (!texts.some((text) => text.includes('{'))) timerDelay(timer);
    } catch (error) {
      issues.push({ severity: 'error', elementId: event, message: `the timer on ${JSON.stringify(event)} cannot be kept: ${(error as Error).message}` });
    }
    if (timer.cycle !== undefined && timer.duration === undefined && timer.date === undefined) {
      const kept = timerDelay(timer) > 0 ? 'waits for its first firing only' : 'passes a schedule at once';
      issues.push({ severity: 'warning', elementId: event, message: `the timer on ${JSON.stringify(event)} is a cycle: a pool walks one path, so the walk ${kept}` });
    }
  }
  return issues;
}
