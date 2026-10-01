import { getCatalog } from '@core/notation';
import { idOf, isElement, type Element, type StudyModel } from '@core/model/index';

export type StateProperty = {
  id: string;
  name: string;
  /** `structureRef` of the referenced item definition, '' when untyped. */
  itemType: string;
};

function builtinItemTypes(): string[] {
  return (getCatalog().enumOf('studyflow:ItemTypeEnum')?.literals ?? [])
    .map((literal) => String(literal.value));
}

function getDeclaredItemTypes(model: StudyModel): string[] {
  const declared = model.study.roots
    .filter((root) => model.host(root) === 'bpmn:ItemDefinition')
    .map((root) => (typeof root.structureRef === 'string' ? root.structureRef.trim() : ''))
    .filter(Boolean);
  return [...new Set(declared)];
}

export function itemTypeOptions(model: StudyModel): string[] {
  const builtins = builtinItemTypes();
  const declared = getDeclaredItemTypes(model)
    .filter((type) => !builtins.includes(type))
    .sort((a, b) => a.localeCompare(b));
  return [...builtins, ...declared];
}

/** The `structureRef` of the item definition `ref` names, '' when it names none. */
function structureOf(model: StudyModel, ref: unknown): string {
  const item = model.get(idOf(ref as never) ?? undefined);
  return typeof item?.structureRef === 'string' ? item.structureRef : '';
}

/** What a message flow carries: the `structureRef` of its message's item definition, '' when it names none. */
export function messageStructureOf(model: StudyModel, flow: Element): string {
  return structureOf(model, model.get(idOf(flow.messageRef) ?? undefined)?.itemRef);
}

/** Only these three may carry Properties in BPMN 2.0 (§10.3.1). */
function supportsStateProperties(model: StudyModel, element: Element): boolean {
  return model.isA(element, 'bpmn:Process') || model.isA(element, 'bpmn:Activity') || model.isA(element, 'bpmn:Event');
}

/** The element whose `properties` an element declares: a pool stands for the process it references. */
export function scopeOf(model: StudyModel, element: Element): Element {
  return model.host(element) === 'bpmn:Participant' ? model.get(idOf(element.processRef) ?? undefined) ?? element : element;
}

export function isScopeContainer(model: StudyModel, element: Element): boolean {
  const scope = scopeOf(model, element);
  return model.isA(scope, 'bpmn:Process') || model.isA(scope, 'bpmn:SubProcess');
}

/** The `bpmn:Property` elements an element declares. */
export function declaredProperties(model: StudyModel, element: Element): Element[] {
  const { properties } = scopeOf(model, element);
  return (Array.isArray(properties) ? properties : []).filter((p): p is Element => isElement(p) && model.host(p) === 'bpmn:Property');
}

export function getStateProperties(model: StudyModel, element: Element): StateProperty[] {
  return declaredProperties(model, element)
    .map((p) => ({
      id: String(p.id),
      name: typeof p.name === 'string' ? p.name : '',
      itemType: structureOf(model, p.itemSubjectRef),
    }));
}

export type ScopedProperty = StateProperty & {
  ownerId: string;
  ownerLabel: string;
  own: boolean;
  ownerIsRoot: boolean;
};

/** Every property an element may read or write, resolved outward through its containers (BPMN 2.0 §10.4.7); an inner declaration shadows an outer one of the same name. */
export function getPropertiesInScope(model: StudyModel, element: Element): ScopedProperty[] {
  const out: ScopedProperty[] = [];
  const seenNames = new Set<string>();

  let node: Element | undefined = scopeOf(model, element);
  let own = true;
  while (node) {
    if (supportsStateProperties(model, node)) {
      for (const property of getStateProperties(model, node)) {
        if (!property.name || seenNames.has(property.name)) continue;
        seenNames.add(property.name);
        out.push({
          ...property,
          ownerId: String(node.id),
          ownerLabel: (typeof node.name === 'string' && node.name) || String(node.id),
          own,
          ownerIsRoot: model.isA(node, 'bpmn:Process'),
        });
      }
    }
    node = model.parentOf(node);
    own = false;
  }
  return out;
}

/** The first `Property_N` no element holds: ids are document-wide, so `taken` answers for the whole document. */
export function nextPropertyId(taken: (id: string) => boolean): string {
  for (let i = 1; ; i += 1) {
    const candidate = `Property_${i}`;
    if (!taken(candidate)) return candidate;
  }
}
