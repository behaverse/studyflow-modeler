import RuleProvider from 'diagram-js/lib/features/rules/RuleProvider';
import { getCatalog } from '@/lib/core/catalog';
import { getExtensionType } from '@/lib/core/extensions';

/** Above bpmn-js's BpmnRules (priority 1000): schema rules win when declared. */
const PRIORITY = 1500;

/** Schema type identity of a canvas element: wrapper type, else the BPMN type. */
function typeRefOf(element: any): string | undefined {
  return getExtensionType(element) ?? element?.businessObject?.$type;
}

/**
 * Schema-driven connection rules.
 *
 * A schema type may declare `meta.connectsTo` (moddle YAML `meta:`)
 * with an allow-list of connection targets. When the source
 * type declares rules they are enforced — allowing or vetoing the connection
 * regardless of the BPMN defaults. When it declares none (all current
 * schemas), the rule returns `undefined` and bpmn-js's built-in BpmnRules
 * decide, so behavior is unchanged.
 */
export default class StudyflowRules extends RuleProvider {
  static $inject = ['eventBus'];

  init() {
    const evaluate = ({ source, target }: any): boolean | undefined => {
      if (!source || !target) return undefined;
      const verdict = getCatalog().connectionVerdict(typeRefOf(source), typeRefOf(target));
      return verdict === 'defer' ? undefined : verdict;
    };

    this.addRule('connection.create', PRIORITY, evaluate);
    this.addRule('connection.reconnect', PRIORITY, evaluate);
  }
}
