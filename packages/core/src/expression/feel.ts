/**
 * FEEL, the expression language of every condition and data-edge selection a study writes (a flow's
 * `conditionExpression`, a loop's `loopCondition`, a conditional event's `condition`, a data edge's
 * `transformation`). FEEL is the expression language of the OMG's DMN standard, BPMN's sibling; `feelin` evaluates
 * it here, for the modeler and the browser runtime, and skills/local/feel.py evaluates the subset the local runtime
 * runs. tests/fixtures/feel.json pins the two row by row. Either reads a `{name}` citation as the name.
 */
import { evaluate, parseExpression } from 'feelin';

import { PLACEHOLDER } from '@core/document/state';

export type FeelResult = { value: unknown; error?: string };

/** The expression with each `{name}` citation as the name it cites: a study may write `{Play.trials} > 3` as its
 * labels do, and it reads as `Play.trials > 3`. */
const cited = (expression: string): string => expression.replace(PLACEHOLDER, '$1');

/** The FEEL functions a study may call: both evaluators have them (feelin, and skills/local/feel.py's subset). */
const FUNCTIONS = new Set(['not', 'contains', 'starts with', 'ends with', 'substring after', 'substring before', 'upper case',
  'lower case', 'string length', 'count', 'sum', 'min', 'max', 'mean', 'abs', 'is defined']);

/** What feelin reads and the subset leaves out, by the node feelin parses it to: a study runs the same in both runtimes. */
const BEYOND: Record<string, string> = {
  QuantifiedExpression: 'some/every … satisfies',
  ForExpression: 'for … return',
  InstanceOfExpression: 'instance of',
  FunctionDefinition: 'a function definition',
  DateTimeLiteral: 'a date or a time',
  Interval: 'a range ([a..b])',
  SimplePositiveUnaryTest: 'a unary test',
  between: 'between',
};

/** Why the expression is not FEEL, or not the FEEL both runtimes run, or undefined when it is. */
export function feelSyntaxError(written: string): string | undefined {
  const expression = cited(written);
  // feelin's parser recovers from Python and JavaScript idioms without an error node; name them outright.
  const code = expression.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const idiom = code.match(/==|&&|\|\||'|!(?!=)/);
  if (idiom) return `not FEEL: ${JSON.stringify(idiom[0])} (FEEL writes = , and, or, not(x), "text")`;
  if (/\[\s*0\s*\]/.test(code)) return 'not FEEL: [0] (a FEEL list starts at 1)';
  const method = code.match(/\.\s*[A-Za-z_]\w*\s*\(/);
  if (method) return `not FEEL: ${JSON.stringify(method[0])} calls a method; FEEL calls functions by name (count(x), upper case(s))`;
  let error: string | undefined;
  const text = (node: { from: number; to: number }): string => expression.slice(node.from, node.to).trim();
  parseExpression(expression, {}, undefined).iterate({
    enter(node) {
      if (error) return false;
      if (node.type.isError) {
        error = `not FEEL at ${node.from}: ${JSON.stringify(expression.slice(node.from, node.from + 12) || expression)}`;
      } else if (BEYOND[node.type.name]) {
        error = `uses ${BEYOND[node.type.name]}, which the FEEL a study runs everywhere leaves out`;
      } else if (node.type.name === 'ArithOp' && text(node) === '**') {
        error = 'uses x ** y, which the FEEL a study runs everywhere leaves out';
      } else if (node.type.name === 'FunctionInvocation') {
        const name = text(node.node.firstChild ?? node);
        if (!FUNCTIONS.has(name)) error = `calls the function ${JSON.stringify(name)}, which the FEEL a study runs everywhere leaves out (it has ${[...FUNCTIONS].join(', ')})`;
      } else if (node.type.name === 'FilterExpression') {
        // `list[1]` picks an item; `list[item > 2]` filters, which the subset does not.
        const inside = node.node.getChild('[')?.nextSibling;
        if (inside && (['Comparison', 'Conjunction', 'Disjunction'].includes(inside.type.name) || /\bitem\b/.test(text(inside)))) {
          error = 'uses a filter (list[condition]), which the FEEL a study runs everywhere leaves out';
        }
      }
      return undefined;
    },
  });
  return error;
}

/** The expression's value over `context`; an expression that is not FEEL, or names something no scope declares, is an error. */
export function evaluateFeel(written: string, context: Record<string, unknown>): FeelResult {
  const expression = cited(written);
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
