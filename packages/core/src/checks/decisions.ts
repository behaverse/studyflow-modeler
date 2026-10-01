import { parseExpression } from 'feelin';

import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { containers, graphOf, quoted } from '@core/checks/graph';
import { expressionOf, idOf, type StudyModel } from '@core/model/index';
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
 * An exclusive gateway's conditions, when each compares the same name to numbers: two that hold for the same value
 * leave the choice to the order of the flows, and a value none holds for, with no default flow, stops the walk. So a
 * criterion whose inequality was flipped, or moved in one branch only, is caught before any run.
 */
export function checkDecisions(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  for (const container of containers(model)) {
    for (const { node, outgoing } of graphOf(model, container).nodes.values()) {
      if (!model.isA(node, BPMN.ExclusiveGateway)) continue;
      const fallback = idOf(node.default);
      const conditionOf = (flow: (typeof outgoing)[number]): string | undefined => expressionOf(flow.conditionExpression)?.body;
      const conditional = outgoing.filter((flow) => flow.id !== fallback && conditionOf(flow) !== undefined);
      if (conditional.length < 2 || conditional.length !== outgoing.length - (fallback ? 1 : 0)) continue;
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
