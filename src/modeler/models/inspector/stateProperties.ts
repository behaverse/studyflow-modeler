import { is } from 'bpmn-js/lib/util/ModelUtil';
import { getCatalog } from '@/core/catalog';
import { toBusinessObject } from '@/core/extensions';

/**
 * A run's variables, read from BPMN's own `bpmn:Property` container.
 *
 * BPMN 2.0 §10.3.1 defines a Property as an item-aware element that, unlike a
 * data object, is never drawn on the diagram, and that only Processes,
 * Activities, and Events may contain. Its type is a `bpmn:ItemDefinition`
 * referenced by `itemSubjectRef`. §10.4.7 makes the containing scope decide
 * what is visible inside it: a property on the process is reachable from every
 * task and sub-process, one on a sub-process only from inside it.
 *
 * Studyflow adds no construct here — the State tab edits these native children,
 * which is why the state of a study is legible to any BPMN 2.0 tool.
 */

export type StateProperty = {
  id: string;
  name: string;
  /** `structureRef` of the referenced item definition, '' when untyped. */
  itemType: string;
  moddleElement: any;
};

/**
 * Scalar types suggested before anything else, from the core schema's
 * `ItemTypeEnum`. A `structureRef` is a free `xsd:QName`-ish string —
 * `pandas.DataFrame` and `sklearn.pipeline.Pipeline` are as valid as
 * `string` — so the enum seeds the picker rather than bounding it, and the
 * type field stays free text.
 */
export function builtinItemTypes(): string[] {
  return (getCatalog().enumOf('studyflow:ItemTypeEnum')?.literals ?? [])
    .map((literal) => String(literal.value));
}

/** The `bpmn:Definitions` root above an element, walking its own tree. */
export function definitionsOf(elementOrBo: any): any {
  let node = toBusinessObject(elementOrBo);
  while (node?.$parent) node = node.$parent;
  return node?.$type === 'bpmn:Definitions' ? node : null;
}

/** Every type the diagram already declares, so one written on a property is a
 *  suggestion on the next, and imported ones (`pandas.DataFrame` in the
 *  sklearn example) are offered without retyping them. */
export function getDeclaredItemTypes(elementOrBo: any): string[] {
  const rootElements: any[] = definitionsOf(elementOrBo)?.rootElements ?? [];
  const declared = rootElements
    .filter((re) => re?.$type === 'bpmn:ItemDefinition')
    .map((re) => (typeof re.structureRef === 'string' ? re.structureRef.trim() : ''))
    .filter(Boolean);
  return [...new Set(declared)];
}

/** Type suggestions for one element: built-in scalars, then the diagram's own. */
export function itemTypeOptions(elementOrBo: any): string[] {
  const builtins = builtinItemTypes();
  const declared = getDeclaredItemTypes(elementOrBo)
    .filter((type) => !builtins.includes(type))
    .sort((a, b) => a.localeCompare(b));
  return [...builtins, ...declared];
}

/** Only these three may carry Properties in BPMN 2.0 (§10.3.1). */
export function supportsStateProperties(element: any): boolean {
  if (!element) return false;
  return is(element, 'bpmn:Process') || is(element, 'bpmn:Activity') || is(element, 'bpmn:Event');
}

/**
 * Whether this element's declarations bound a scope instance. A process or
 * sub-process opens one; a plain task or event carries properties that live
 * for that element's own execution.
 */
export function isScopeContainer(element: any): boolean {
  return is(element, 'bpmn:Process') || is(element, 'bpmn:SubProcess');
}

/**
 * The name bpmn-js gives the `bpmn:Property` it invents to satisfy the XSD.
 *
 * A `bpmn:DataInputAssociation` requires a `targetRef`, but drawing a data association from
 * a data object to a step says nothing about what it lands on, so bpmn-js's
 * `DataInputAssociationBehavior` parks the reference on a placeholder Property
 * it adds to the activity. It is an artifact of the file format, not something
 * the study declares: every association drawn on the canvas would otherwise show up in
 * the State tab as a variable nobody named, and be offered as a bind target in
 * the data-flow list.
 */
const TARGET_REF_PLACEHOLDER = '__targetRef_placeholder';

/** Declared `bpmn:Property` children, minus the ones no author wrote. */
function declaredProperties(element: any): any[] {
  const businessObject = toBusinessObject(element);
  const properties = businessObject?.get?.('properties') ?? businessObject?.properties ?? [];
  return (Array.isArray(properties) ? properties : []).filter((p: any) => p?.$type === 'bpmn:Property');
}

export function getStateProperties(element: any): StateProperty[] {
  return declaredProperties(element)
    .filter((p: any) => p.name !== TARGET_REF_PLACEHOLDER)
    .map((p: any) => ({
      id: p.id,
      name: typeof p.name === 'string' ? p.name : '',
      itemType: p.itemSubjectRef?.structureRef ?? '',
      moddleElement: p,
    }));
}

export type ScopedProperty = StateProperty & {
  /** Element declaring it — this one, or an enclosing container. */
  ownerId: string;
  ownerLabel: string;
  /** True when the inspected element declares it itself. */
  own: boolean;
  /** True when the owner is the process — the study-wide default scope. */
  ownerIsRoot: boolean;
};

/**
 * Every property an element may read or write, resolved outward through its
 * containers (BPMN 2.0 §10.4.7): its own declarations first, then those of
 * each enclosing sub-process, then the process. An inner declaration shadows
 * an outer one of the same name, exactly as it does at run time.
 */
export function getPropertiesInScope(element: any): ScopedProperty[] {
  const out: ScopedProperty[] = [];
  const seenNames = new Set<string>();

  let node = toBusinessObject(element);
  let own = true;
  while (node) {
    if (supportsStateProperties(node)) {
      for (const property of getStateProperties(node)) {
        if (!property.name || seenNames.has(property.name)) continue;
        seenNames.add(property.name);
        out.push({
          ...property,
          ownerId: node.id,
          ownerLabel: node.name || node.id,
          own,
          ownerIsRoot: is(node, 'bpmn:Process'),
        });
      }
    }
    node = node.$parent;
    own = false;
  }
  return out;
}

/** Stable, readable, collision-free id for a new declaration. Counts the
 *  hidden placeholder too — it is invisible, not absent, and two properties
 *  sharing an id collapse into one on the next parse. */
export function nextPropertyId(element: any): string {
  const taken = new Set(declaredProperties(element).map((p: any) => p.id));
  for (let i = 1; ; i += 1) {
    const candidate = `Property_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
