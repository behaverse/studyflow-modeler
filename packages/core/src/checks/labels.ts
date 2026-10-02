import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { containers, graphOf } from '@core/checks/graph';
import { namesIn } from '@core/expression/feel';
import { expressionOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index';
import { asPercentage, declaredIn } from '@core/model/state';

/** Where BPMN writes the FEEL that decides an element: a flow's condition, a conditional event's, a loop's. */
const CONDITIONS = ['conditionExpression', 'condition', 'loopCondition', 'loopCardinality', 'completionCondition'];

/** A number a name writes, `4`, `0.05`, `.05` or `20%`, and not a digit of a word or of a longer number. */
const NUMBER = /(?<![\p{L}\p{N}_.])(\d+(?:\.\d+)?|\.\d+)(%?)/gu;

const list = (value: Value | undefined): Element[] => (Array.isArray(value) ? value : [value]).filter(isElement);

/**
 * A name that copies, as a number, a value its element reads: a boundary event named "> 20% unanswered" whose
 * condition reads `max_unanswered: 0.2` holds the threshold twice, and an edit to the property leaves the label
 * behind. The warning names the placeholder that shows the value instead (`{max_unanswered:%}`). An element reads
 * the names its conditions cite, and a gateway those on the flows out of it, whose question its name asks; only a
 * value the file declares counts, so a number written in the condition itself, which no placeholder can cite, does not.
 */
export function checkLabels(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  const check = (element: Element, holders: Element[]): void => {
    const { id } = element;
    const name = typeof element.name === 'string' ? element.name : '';
    if (typeof id !== 'string' || !/\d/.test(name)) return;
    const reads = new Map<string, number>();
    for (const holder of holders.flatMap((each) => [each, ...list(each.eventDefinitions), ...list(each.loopCharacteristics)])) {
      for (const key of CONDITIONS) {
        const body = expressionOf(holder[key])?.body;
        for (const read of body ? namesIn(body) : []) {
          const value = declaredIn(model, id, read);
          if (typeof value === 'number') reads.set(read, value);
        }
      }
    }
    const copied: string[] = [];
    const named = name.replace(NUMBER, (written, digits: string, percent: string) => {
      const number = Number(digits);
      for (const [read, value] of reads) {
        const placeholder = percent && asPercentage(value) === `${number}%` ? `{${read}:%}` : value === number ? `{${read}}${percent}` : undefined;
        if (placeholder) {
          copied.push(`${read} (${value})`);
          return placeholder;
        }
      }
      return written;
    });
    if (named === name) return;
    issues.push({
      severity: 'warning',
      elementId: id,
      message: `${JSON.stringify(id)} copies ${copied.join(', ')}, which it reads, into its name: name it ${JSON.stringify(named)}, so the label shows the value the file declares`,
    });
  };
  for (const container of containers(model)) {
    const { flows, nodes } = graphOf(model, container);
    for (const flow of flows) check(flow, [flow]);
    for (const { node, outgoing } of nodes.values()) check(node, model.isA(node, BPMN.Gateway) ? [node, ...outgoing] : [node]);
  }
  return issues;
}
