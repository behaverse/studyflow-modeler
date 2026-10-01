import type { ModdleElement } from '@core/element/moddle';
import { RESERVED_DOC_KEYS, type YamlDoc } from '@core/document/format';
import { expandInlineFlow, keyedMapToList } from '@core/model/spelling';

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && !Array.isArray(value);

/** The property of `parent` that holds `child`, by containment. */
function holderOf(parent: ModdleElement, child: ModdleElement): { name: string; isMany: boolean } | undefined {
  for (const property of parent.$descriptor?.properties ?? []) {
    if (property.isReference) continue;
    const held = parent[property.name];
    if (held === child || (Array.isArray(held) && held.includes(child))) return { name: property.name, isMany: !!property.isMany };
  }
  return undefined;
}

/** The mapping `doc`, a document's `.studyflow.yaml` tree, spells `element` as: found along the path from its root,
 * a flow written `A -> B` opened into a mapping on the way. Undefined where the tree spells it some other way. */
function nodeOf(doc: YamlDoc, element: ModdleElement): Node | undefined {
  const chain: ModdleElement[] = [];
  for (let at: ModdleElement | undefined = element; at && at.$type !== 'bpmn:Definitions'; at = at.$parent) chain.unshift(at);
  const [root] = chain;
  if (!root?.id) return undefined;
  const listed = Array.isArray(doc.elements) ? doc.elements.find((entry) => isNode(entry) && entry.id === root.id) : undefined;
  let node: unknown = !RESERVED_DOC_KEYS.has(root.id) && isNode(doc[root.id]) ? doc[root.id] : listed;
  for (let i = 1; i < chain.length && isNode(node); i += 1) {
    const child = chain[i];
    const holder = holderOf(chain[i - 1], child);
    if (!holder) return undefined;
    const held: unknown = node[holder.name];
    if (!holder.isMany) node = held;
    else if (Array.isArray(held)) node = held.find((entry) => isNode(entry) && entry.id === child.id);
    else if (isNode(held) && typeof child.id === 'string' && child.id in held) {
      if (!isNode(held[child.id])) {
        const { id: _id, ...opened } = expandInlineFlow(keyedMapToList({ [child.id]: held[child.id] })[0]) as Node;
        held[child.id] = opened;
      }
      node = held[child.id];
    } else return undefined;
  }
  return isNode(node) ? node : undefined;
}

/**
 * Sets `attribute` of `element` in `doc`, the document's `.studyflow.yaml` tree, to `value` as the file spells it: a
 * loop marker, an event's definitions, a condition, a default flow, the properties a scope declares, the data a step
 * reads. `null` clears it. False when the tree does not spell the element as a mapping of its own; reading the tree
 * back is what checks the value.
 */
export function patchDoc(doc: YamlDoc, element: ModdleElement, attribute: string, value: unknown): boolean {
  const node = nodeOf(doc, element);
  if (!node) return false;
  if (value === null || value === undefined) delete node[attribute];
  else node[attribute] = value;
  return true;
}
