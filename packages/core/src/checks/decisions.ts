import { parseExpression } from 'feelin';

import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { containers, graphOf, quoted } from '@core/checks/graph';
import { expressionOf, idOf, type Element, type StudyModel } from '@core/model/index';
import { cited } from '@core/expression/feel';

/** A set of numbers: its intervals, each open or closed at either end. */
type Interval = { low: number; high: number; lowIn: boolean; highIn: boolean };
type Range = Interval[];

const ALL: Range = [{ low: -Infinity, high: Infinity, lowIn: false, highIn: false }];

const empty = ({ low, high, lowIn, highIn }: Interval): boolean => low > high || (low === high && !(lowIn && highIn));

function intersect(a: Range, b: Range): Range {
  return a.flatMap((x) => b.map((y): Interval => {
    const [low, lowIn] = x.low > y.low ? [x.low, x.lowIn] : x.low < y.low ? [y.low, y.lowIn] : [x.low, x.lowIn && y.lowIn];
    const [high, highIn] = x.high < y.high ? [x.high, x.highIn] : x.high > y.high ? [y.high, y.highIn] : [x.high, x.highIn && y.highIn];
    return { low, high, lowIn, highIn };
  })).filter((interval) => !empty(interval));
}

function complement(range: Range): Range {
  let rest = ALL;
  for (const { low, high, lowIn, highIn } of range) {
    rest = intersect(rest, [
      { low: -Infinity, high: low, lowIn: false, highIn: !lowIn },
      { low: high, high: Infinity, lowIn: !highIn, highIn: false },
    ]);
  }
  return rest;
}

const union = (a: Range, b: Range): Range => complement(intersect(complement(a), complement(b)));

function spelled(range: Range): string {
  const end = (value: number): string => (value === Infinity ? '∞' : value === -Infinity ? '-∞' : String(value));
  return range.map(({ low, high, lowIn, highIn }) => (low === high ? `= ${end(low)}` : `in ${lowIn ? '[' : '('}${end(low)}, ${end(high)}${highIn ? ']' : ')'}`)).join(' or ');
}

/**
 * The numbers a condition holds for, when it compares one name to numbers (`accuracy >= 0.8`, `x > 1 and x <= 3`),
 * with the name; undefined for any other condition, which is not analysed.
 */
function rangeOf(expression: string): { name: string; range: Range } | undefined {
  const text = cited(expression);
  const tree = parseExpression(text, {}, undefined);
  let name: string | undefined;
  const read = (node: any): Range | undefined => {
    const kids: any[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) kids.push(child);
    const of = (child: any): string => text.slice(child.from, child.to).trim();
    switch (node.type.name) {
      case 'Expression': return kids.length === 1 ? read(kids[0]) : undefined;
      case 'ParenthesizedExpression': return read(kids.find((kid) => !['(', ')'].includes(kid.type.name)));
      case 'Conjunction':
      case 'Disjunction': {
        const [left, , right] = kids;
        const a = left && read(left);
        const b = right && read(right);
        return a && b ? (node.type.name === 'Conjunction' ? intersect(a, b) : union(a, b)) : undefined;
      }
      case 'Comparison': {
        const [left, op, right] = kids;
        if (!left || op?.type.name !== 'CompareOp' || !right) return undefined;
        const numberAt = (child: any): number | undefined => (child.type.name === 'NumericLiteral' ? Number(of(child)) : undefined);
        const named = (child: any): string | undefined => (['VariableName', 'PathExpression'].includes(child.type.name) ? of(child) : undefined);
        let operator = of(op);
        let [subject, value] = [named(left), numberAt(right)];
        if (subject === undefined) {
          [subject, value] = [named(right), numberAt(left)];
          operator = ({ '<': '>', '<=': '>=', '>': '<', '>=': '<=' } as Record<string, string>)[operator] ?? operator;
        }
        if (subject === undefined || value === undefined || (name !== undefined && name !== subject)) return undefined;
        name = subject;
        const c = value;
        switch (operator) {
          case '<': return [{ low: -Infinity, high: c, lowIn: false, highIn: false }];
          case '<=': return [{ low: -Infinity, high: c, lowIn: false, highIn: true }];
          case '>': return [{ low: c, high: Infinity, lowIn: false, highIn: false }];
          case '>=': return [{ low: c, high: Infinity, lowIn: true, highIn: false }];
          case '=': return [{ low: c, high: c, lowIn: true, highIn: true }];
          case '!=': return complement([{ low: c, high: c, lowIn: true, highIn: true }]);
          default: return undefined;
        }
      }
      default: return undefined;
    }
  };
  const range = read(tree.topNode);
  return range && name ? { name, range } : undefined;
}

/**
 * An inclusive gateway takes every flow whose condition holds and every flow without one, and its default flow when no
 * condition holds. With a condition on every flow but the default, and either one condition and a default flow or
 * conditions on one number no two of which hold together, it never takes two flows at once: a decision, which an
 * exclusive gateway draws. It runs as drawn, so this is a warning.
 */
function singleFlow(
  node: Element,
  outgoing: Element[],
  conditional: Element[],
  fallback: string | null,
  conditionOf: (flow: Element) => string | undefined,
): Issue[] {
  const decision = (why: string): Issue[] => [{
    severity: 'warning',
    elementId: node.id,
    message: `${quoted(node)} is an inclusive gateway, but ${why}, so it never takes more than one flow: make it an exclusive gateway`,
  }];
  const otherwise = outgoing.find((flow) => flow.id === fallback);
  if (conditional.length === 1 && otherwise) {
    return decision(`it takes its default flow ${quoted(otherwise)} only when the condition on ${quoted(conditional[0])} fails`);
  }
  if (conditional.length < 2) return [];
  const ranges = conditional.map((flow) => rangeOf(conditionOf(flow)!));
  if (ranges.some((found) => !found) || new Set(ranges.map((found) => found!.name)).size !== 1) return [];
  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length; j += 1) {
      if (intersect(ranges[i]!.range, ranges[j]!.range).length > 0) return [];
    }
  }
  return decision(`no two of the conditions on ${conditional.map(quoted).join(', ')} hold together`);
}

/**
 * An exclusive gateway's conditions, when each compares the same name to numbers: two that hold for the same value
 * leave the choice to the order of the flows, and a value none holds for, with no default flow, stops the walk. So a
 * criterion whose inequality was flipped, or moved in one branch only, is caught before any run. And a decision drawn
 * as a split: a parallel gateway with conditions on its flows, which it never reads, or an inclusive gateway that never
 * takes two flows at once.
 */
export function checkDecisions(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  for (const container of containers(model)) {
    for (const { node, outgoing } of graphOf(model, container).nodes.values()) {
      // A parallel gateway takes every flow out of it: a condition on one is a decision it never makes (BPMN 2.0).
      const conditioned = outgoing.filter((flow) => expressionOf(flow.conditionExpression) !== undefined);
      if (model.isA(node, BPMN.ParallelGateway) && conditioned.length > 0) {
        issues.push({
          severity: 'error',
          elementId: node.id,
          message: `${quoted(node)} is a parallel gateway, which takes every flow out of it, so it never reads the conditions on ${conditioned.map(quoted).join(', ')}: make it an exclusive gateway, or an inclusive one if several may hold at once`,
        });
      }
      const inclusive = model.isA(node, BPMN.InclusiveGateway);
      if (!inclusive && !model.isA(node, BPMN.ExclusiveGateway)) continue;
      const fallback = idOf(node.default);
      const conditionOf = (flow: (typeof outgoing)[number]): string | undefined => expressionOf(flow.conditionExpression)?.body;
      const conditional = outgoing.filter((flow) => flow.id !== fallback && conditionOf(flow) !== undefined);
      if (conditional.length !== outgoing.length - (fallback ? 1 : 0)) continue;
      if (inclusive) {
        issues.push(...singleFlow(node, outgoing, conditional, fallback, conditionOf));
        continue;
      }
      if (conditional.length < 2) continue;
      const ranges = conditional.map((flow) => rangeOf(conditionOf(flow)!));
      if (ranges.some((found) => !found) || new Set(ranges.map((found) => found!.name)).size !== 1) continue;
      const name = ranges[0]!.name;
      for (let i = 0; i < ranges.length; i += 1) {
        for (let j = i + 1; j < ranges.length; j += 1) {
          const both = intersect(ranges[i]!.range, ranges[j]!.range);
          if (both.length === 0) continue;
          issues.push({
            severity: 'warning',
            elementId: node.id,
            message: `${quoted(node)}: for ${name} ${spelled(both)}, both ${quoted(conditional[i])} and ${quoted(conditional[j])} hold, and the walk takes the first in the file's order`,
          });
        }
      }
      const none = complement(ranges.reduce((covered, found) => union(covered, found!.range), [] as Range));
      if (none.length > 0 && !fallback) {
        issues.push({
          severity: 'error',
          elementId: node.id,
          message: `${quoted(node)}: for ${name} ${spelled(none)}, no condition holds and there is no default flow, so the walk stops there`,
        });
      }
    }
  }
  return issues;
}
