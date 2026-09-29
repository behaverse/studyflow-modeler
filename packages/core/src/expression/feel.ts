/**
 * FEEL, the expression language of every condition and data-edge selection a study writes (a flow's
 * `conditionExpression`, a loop's `loopCondition`, a conditional event's `condition`, a data edge's
 * `transformation`). FEEL is the expression language of the OMG's DMN standard, BPMN's sibling; `feelin` evaluates
 * it here, for the modeler and the browser runtime, and skills/local/feel.py evaluates the subset the local runtime
 * runs. tests/fixtures/feel.json pins the two row by row.
 */
import { evaluate, parseExpression } from 'feelin';

export type FeelResult = { value: unknown; error?: string };

/** Why the expression is not FEEL, or undefined when it parses. */
export function feelSyntaxError(expression: string): string | undefined {
  // feelin's parser recovers from Python and JavaScript idioms without an error node; name them outright.
  const code = expression.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const idiom = code.match(/==|&&|\|\||'|!(?!=)/);
  if (idiom) return `not FEEL: ${JSON.stringify(idiom[0])} (FEEL writes = , and, or, not(x), "text")`;
  let error: string | undefined;
  parseExpression(expression, {}, undefined).iterate({
    enter(node) {
      if (!error && node.type.isError) {
        error = `not FEEL at ${node.from}: ${JSON.stringify(expression.slice(node.from, node.from + 12) || expression)}`;
      }
    },
  });
  return error;
}

/** The expression's value over `context`; an expression that is not FEEL, or names something no scope declares, is an error. */
export function evaluateFeel(expression: string, context: Record<string, unknown>): FeelResult {
  const syntax = feelSyntaxError(expression);
  if (syntax) return { value: null, error: syntax };
  try {
    // A name a scope declares but has not written is null, not missing.
    const declared = Object.fromEntries(Object.entries(context).map(([name, value]) => [name, value === undefined ? null : value]));
    const { value, warnings } = evaluate(expression, declared);
    const missing = warnings.find((warning) => warning.type === 'NO_VARIABLE_FOUND');
    if (missing) {
      const name = /'([^']+)'/.exec(missing.message)?.[1] ?? missing.message;
      return { value: null, error: `'${name}' is not declared by any scope in this run` };
    }
    return { value: value ?? null };
  } catch (error) {
    return { value: null, error: (error as Error).message };
  }
}

/** Whether a condition holds: only `true` does. */
export function feelHolds(expression: string, context: Record<string, unknown>): FeelResult {
  const { value, error } = evaluateFeel(expression, context);
  return { value: value === true, error };
}
