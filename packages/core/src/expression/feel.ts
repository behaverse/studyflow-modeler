/**
 * FEEL, the expression language of every condition and data-edge selection a study writes (a flow's
 * `conditionExpression`, a loop's `loopCondition`, a conditional event's `condition`, a data edge's
 * `transformation`). FEEL is the expression language of the OMG's DMN standard, BPMN's sibling; `feelin` evaluates
 * it here, for the walk in every runtime and the modeler, and packages/runtime-local/python/feel.py evaluates the same subset for
 * runners written in Python. tests/fixtures/feel.json pins the two row by row. Either reads a `{name}` citation as the name.
 */
import { evaluate, parseExpression } from 'feelin';

type SyntaxNode = ReturnType<typeof parseExpression>['topNode'];

import { PLACEHOLDER } from '@core/model/state';

export type FeelResult = { value: unknown; error?: string };

/** The expression with each `{name}` citation as the name it cites: a study may write `{Play.trials} > 3` as its
 * labels do, and it reads as `Play.trials > 3`. */
export const cited = (expression: string): string => expression.replace(PLACEHOLDER, '$1');

/** The names an expression reads, a path by the name it starts from (`congruency_test` and `alpha` in
 * `congruency_test.pvalue < alpha`); the name of a function it calls is one too. */
export function namesIn(written: string): Set<string> {
  const expression = cited(written);
  const names = new Set<string>();
  parseExpression(expression, {}, undefined).iterate({
    enter(node) {
      if (node.type.name === 'VariableName') names.add(expression.slice(node.from, node.to));
    },
  });
  return names;
}

/** The FEEL functions a study may call: both evaluators have them (feelin, and packages/runtime-local/python/feel.py's subset). */
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

/** Whether a node sits in the condition of a filter (`xs[...]`), past its opening bracket. */
function insideFilter(node: { node: SyntaxNode; from: number }): boolean {
  for (let up = node.node.parent; up; up = up.parent) {
    const bracket = up.type.name === 'FilterExpression' ? up.getChild('[') : null;
    if (bracket && node.from >= bracket.to) return true;
  }
  return false;
}

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
      } else if (node.type.name === 'FunctionInvocation' && insideFilter(node)) {
        error = 'calls a function inside a filter\'s condition, which the FEEL a study runs everywhere leaves out: filter first, then call it on the list (count(xs[item > 1]))';
      } else if (node.type.name === 'FunctionInvocation') {
        const name = text(node.node.firstChild ?? node);
        if (!FUNCTIONS.has(name)) error = `calls the function ${JSON.stringify(name)}, which the FEEL a study runs everywhere leaves out (it has ${[...FUNCTIONS].join(', ')})`;
      }
      return undefined;
    },
  });
  return error;
}

const ORDERED = '__ordered';
const DEFINED = '__defined';
const RELATIONS = new Set(['<', '<=', '>', '>=']);

/** `a < b` as DMN orders it: a number with a number, a string with a string, and null for any other pair, where
 * feelin says false (so `not(1 < "b")` would hold). */
function ordered(left: unknown, relation: string, right: unknown): boolean | null {
  const kind = typeof left;
  if (left === null || right === null || kind !== typeof right || (kind !== 'number' && kind !== 'string')) return null;
  const [a, b] = [left as number | string, right as number | string];
  return relation === '<' ? a < b : relation === '<=' ? a <= b : relation === '>' ? a > b : a >= b;
}

function defined(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/** The name a path, an index or a name starts from; none for any other expression. */
function rootName(node: SyntaxNode, expression: string): string | undefined {
  let root: SyntaxNode | null = node;
  while (root && (root.type.name === 'PathExpression' || root.type.name === 'FilterExpression')) root = root.firstChild;
  return root?.type.name === 'VariableName' ? expression.slice(root.from, root.to) : undefined;
}

/** The expression as feelin evaluates it: each ordering comparison a call to `ordered`, and each `is defined(x)`, which
 * feelin lacks, read as feel.py reads it: a name is defined when a scope declares it, a path when it reaches a value. */
function forFeelin(expression: string, declared: Set<string>): string {
  const spell = (node: SyntaxNode): string => {
    // A filter's condition stays as written: feelin loses the item's scope inside a call it would become, and a filter
    // keeps an item only where its condition is true, so a comparison DMN reads as null drops it as false does.
    if (node.type.name === 'FilterExpression' && node.firstChild) {
      return spell(node.firstChild) + expression.slice(node.firstChild.to, node.to);
    }
    const [left, operator, right] = [node.firstChild, node.firstChild?.nextSibling, node.lastChild];
    const relation = operator && expression.slice(operator.from, operator.to);
    if (node.type.name === 'Comparison' && operator?.type.name === 'CompareOp' && left && right && RELATIONS.has(relation!)) {
      return `${ORDERED}(${spell(left)}, "${relation}", ${spell(right)})`;
    }
    const argument = node.getChild('PositionalParameters')?.firstChild;
    if (node.type.name === 'FunctionInvocation' && left && expression.slice(left.from, left.to) === 'is defined' && argument && !argument.nextSibling) {
      const root = rootName(argument, expression);
      if (root !== undefined && !declared.has(root)) return 'false';
      return argument.type.name === 'VariableName' ? 'true' : `${DEFINED}(${spell(argument)})`;
    }
    let text = '';
    let at = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      text += expression.slice(at, child.from) + spell(child);
      at = child.to;
    }
    return text + expression.slice(at, node.to);
  };
  return spell(parseExpression(expression, {}, undefined).topNode);
}

/** The expression's value over `context`; an expression that is not FEEL, or names something no scope declares, is an error. */
export function evaluateFeel(written: string, context: Record<string, unknown>): FeelResult {
  const expression = cited(written);
  const syntax = feelSyntaxError(expression);
  if (syntax) return { value: null, error: syntax };
  try {
    // A name a scope declares but has not written is null, not missing.
    const declared = Object.fromEntries(Object.entries(context).map(([name, value]) => [name, value === undefined ? null : value]));
    const { value, warnings } = evaluate(forFeelin(expression, new Set(Object.keys(declared))), { ...declared, [ORDERED]: ordered, [DEFINED]: defined });
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
