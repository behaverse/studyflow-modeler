import { RESERVED_DOC_KEYS, type YamlDoc } from '@core/model/yaml';
import type { Element, StudyModel } from '@core/model/index';
import { EVENT_KINDS, LOOP_KINDS, fileKey, modelKey } from '@core/model/names';
import { expandInlineFlow, keyedMapToList } from '@core/model/spelling';

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && !Array.isArray(value);

/** The mapping `doc`, a study's `.studyflow.yaml` tree, spells `element` as: found along the path from its root,
 * a flow written `A -> B` opened into a mapping on the way. Undefined where the tree spells it some other way. */
function nodeOf(doc: YamlDoc, model: StudyModel, element: Element): Node | undefined {
  const chain: Element[] = [];
  for (let at: Element | undefined = element; at; at = model.parentOf(at)) chain.unshift(at);
  const [root] = chain;
  if (!root?.id) return undefined;
  const listed = Array.isArray(doc.elements) ? doc.elements.find((entry) => isNode(entry) && entry.id === root.id) : undefined;
  let node: unknown = !RESERVED_DOC_KEYS.has(root.id) && isNode(doc[root.id]) ? doc[root.id] : listed;
  for (let i = 1; i < chain.length && isNode(node); i += 1) {
    const child = chain[i];
    const holder = model.holderOf(child);
    if (!holder) return undefined;
    const isMany = Array.isArray(chain[i - 1][holder.key]);
    const held: unknown = node[fileKey(model.metamodel, model.host(chain[i - 1]), holder.key)] ?? node[holder.key];
    if (!isMany) node = held;
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
 * The property `key` names on `element`, a key as the file writes it or by BPMN's name, and the key itself: an event's
 * kind names its definitions, an activity's marker kind its loop characteristics. Undefined for a key it names none by.
 */
export function attributeOf(model: StudyModel, element: Element, key: string): { name: string; key: string } | undefined {
  const host = model.host(element);
  const local = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
  if (model.property(element, local)) return { name: local, key };
  const name = modelKey(model.metamodel, host, key);
  if (name !== key && model.property(element, name)) return { name, key };
  if (model.property(element, 'eventDefinitions') && Object.values(EVENT_KINDS).some((kind) => kind.key === key)) return { name: 'eventDefinitions', key };
  if (model.property(element, 'loopCharacteristics') && Object.values(LOOP_KINDS).includes(key)) return { name: 'loopCharacteristics', key };
  return undefined;
}

/** Every key the file may write `element`'s property `name` under: BPMN's name, the file's, and its kinds. */
function spellingsOf(model: StudyModel, element: Element, name: string): string[] {
  const kinds = name === 'eventDefinitions' ? Object.values(EVENT_KINDS).map((kind) => kind.key)
    : name === 'loopCharacteristics' ? Object.values(LOOP_KINDS) : [];
  return [name, fileKey(model.metamodel, model.host(element), name), ...kinds];
}

/**
 * Sets `attribute` of `element` in `doc`, the document's `.studyflow.yaml` tree, to `value` as the file spells it: a
 * loop marker, an event's definition, a condition, a default flow, the properties a scope declares, the data a step
 * reads. `attribute` is the key it goes under, the file's or BPMN's, and any other spelling of the same property is
 * taken out. `null` clears it. False when the tree does not spell the element as a mapping of its own; reading the tree
 * back is what checks the value.
 */
export function patchDoc(doc: YamlDoc, model: StudyModel, element: Element, attribute: string, value: unknown): boolean {
  const node = nodeOf(doc, model, element);
  if (!node) return false;
  const name = attributeOf(model, element, attribute)?.name ?? attribute;
  for (const key of spellingsOf(model, element, name)) delete node[key];
  if (value !== null && value !== undefined) node[attribute] = value;
  return true;
}
