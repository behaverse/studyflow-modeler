import { is } from 'bpmn-js/lib/util/ModelUtil';
import { getCatalog } from '@core/notation';
import { toBusinessObject, type ModdleElement } from '@core/element';
import { isDeclaredProperty } from '@core/constants';

export type StateProperty = {
  id: string;
  name: string;
  /** `structureRef` of the referenced item definition, '' when untyped. */
  itemType: string;
  moddleElement: any;
};

function builtinItemTypes(): string[] {
  return (getCatalog().enumOf('studyflow:ItemTypeEnum')?.literals ?? [])
    .map((literal) => String(literal.value));
}

export function definitionsOf(elementOrBo: any): any {
  let node = toBusinessObject(elementOrBo);
  while (node?.$parent) node = node.$parent;
  return node?.$type === 'bpmn:Definitions' ? node : null;
}

function getDeclaredItemTypes(elementOrBo: any): string[] {
  const rootElements: any[] = definitionsOf(elementOrBo)?.rootElements ?? [];
  const declared = rootElements
    .filter((re) => re?.$type === 'bpmn:ItemDefinition')
    .map((re) => (typeof re.structureRef === 'string' ? re.structureRef.trim() : ''))
    .filter(Boolean);
  return [...new Set(declared)];
}

export function itemTypeOptions(elementOrBo: any): string[] {
  const builtins = builtinItemTypes();
  const declared = getDeclaredItemTypes(elementOrBo)
    .filter((type) => !builtins.includes(type))
    .sort((a, b) => a.localeCompare(b));
  return [...builtins, ...declared];
}

/** Only these three may carry Properties in BPMN 2.0 (§10.3.1). */
function supportsStateProperties(element: any): boolean {
  if (!element) return false;
  return is(element, 'bpmn:Process') || is(element, 'bpmn:Activity') || is(element, 'bpmn:Event');
}

export function isScopeContainer(element: any): boolean {
  return is(element, 'bpmn:Process') || is(element, 'bpmn:SubProcess');
}

function declaredProperties(element: any): any[] {
  const businessObject = toBusinessObject(element);
  const properties = businessObject?.get?.('properties') ?? businessObject?.properties ?? [];
  return (Array.isArray(properties) ? properties : []).filter((p: any) => isDeclaredProperty(p));
}

export function getStateProperties(element: any): StateProperty[] {
  return declaredProperties(element)
    .map((p: any) => ({
      id: p.id,
      name: typeof p.name === 'string' ? p.name : '',
      itemType: p.itemSubjectRef?.structureRef ?? '',
      moddleElement: p,
    }));
}

export type ScopedProperty = StateProperty & {
  ownerId: string;
  ownerLabel: string;
  own: boolean;
  ownerIsRoot: boolean;
};

/** Every property an element may read or write, resolved outward through its containers (BPMN 2.0 §10.4.7); an inner declaration shadows an outer one of the same name. */
export function getPropertiesInScope(element: any): ScopedProperty[] {
  const out: ScopedProperty[] = [];
  const seenNames = new Set<string>();

  let node: ModdleElement | undefined = toBusinessObject(element);
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

export function nextPropertyId(element: any): string {
  const taken = new Set(declaredProperties(element).map((p: any) => p.id));
  for (let i = 1; ; i += 1) {
    const candidate = `Property_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
