import { CHECKLIST_SPEC, StudyflowElement, getAttribute, isExtensionPrefix } from '@/core/element';
import { getCatalog, UNDECLARED_CATEGORY_ORDER, type AttributeSpec } from '@/core/notation';
import { toLocalName } from '@/core/naming';
import { supportsLoopCharacteristics } from '@/modeler/inspector/loopCharacteristics';
import { isScopeContainer } from '@/modeler/inspector/stateProperties';

export function isAttributeVisible(attrDef: AttributeSpec | undefined, element: any): boolean {
  if (!attrDef || !element) return true;
  if (attrDef.meta?.pinned) return false;
  if (!attrDef.meta?.condition) return true;

  const conditions = attrDef.meta.condition.body || {};
  return Object.entries(conditions).every(([key, expected]) => {
    const actual = getAttribute(element, key);
    if (expected === '$set') return actual != null;
    if (Array.isArray(expected)) return expected.includes(actual);
    return actual === expected;
  });
}

function declaredCategories(): Map<string, { order: number; synthetic: boolean }> {
  return new Map(getCatalog().categories().map((category) => [
    category.name,
    { order: category.order, synthetic: category.synthetic },
  ]));
}

function isIdentity(attrDef: AttributeSpec): boolean {
  const name = attrDef?.ns?.name ?? attrDef?.name;
  const localName = attrDef?.ns?.localName ?? toLocalName(name);
  return (
    attrDef?.isId
    || name === 'bpmn:id'
    || name === 'bpmn:name'
    || localName === 'id'
    || localName === 'name'
  );
}

export function getAttributesByCategory(element: any): Record<string, AttributeSpec[]> {
  const byCategory: Record<string, AttributeSpec[]> = {};
  const handle = StudyflowElement.fromBusinessObject(element);
  const extAttrDefs = handle.extensionAttributes();
  const seen = new Set<string>();

  const overridden = new Set(
    extAttrDefs
      .map((attrDef) => attrDef.redefinedName ?? attrDef.ns?.localName ?? attrDef.name)
      .filter((name): name is string => Boolean(name))
  );

  const identity = [
    handle.attribute('bpmn:id'),
    handle.attribute('bpmn:name'),
  ].filter((d): d is AttributeSpec => Boolean(d));

  const collect = (attrDefs: AttributeSpec[], predicate: (attrDef: AttributeSpec) => boolean) => {
    attrDefs.forEach((attrDef) => {
      if (!predicate(attrDef)) return;
      if (!isAttributeVisible(attrDef, element)) return;

      const key = attrDef.ns?.name ?? attrDef.name;
      if (seen.has(key)) return;
      seen.add(key);

      (attrDef.meta?.categories ?? ['General']).forEach((category: string) => {
        (byCategory[category] ??= []).push(attrDef);
      });
    });
  };

  collect(identity, () => true);

  // Schema-declared attributes render; plain BPMN natives don't.
  const isDeclared = (attrDef: AttributeSpec) => isExtensionPrefix(attrDef.ns?.prefix) || !!attrDef.redefines;

  collect(handle.attributes(), (attrDef: AttributeSpec) =>
    !overridden.has(attrDef.ns?.localName ?? attrDef.name)
    && !isIdentity(attrDef)
    && isDeclared(attrDef)
  );

  collect(extAttrDefs, isDeclared);

  // `checklist` is a view over `bpmn:documentation`, not a stored attribute — synthesize its field.
  collect([CHECKLIST_SPEC], () => true);

  if (supportsLoopCharacteristics(element) || isScopeContainer(element)) {
    byCategory['Execution'] ??= [];
  }

  for (const attrDefs of Object.values(byCategory)) {
    attrDefs.sort((a: any, b: any) => {
      const orderA = a.meta?.order ?? Infinity;
      const orderB = b.meta?.order ?? Infinity;
      return orderA - orderB;
    });
  }

  const declared = declaredCategories();

  return Object.fromEntries(
    Object.entries(byCategory)
      .filter(([name, attrDefs]) => attrDefs.length > 0 || declared.get(name)?.synthetic === true)
      .sort(([a], [b]) =>
        (declared.get(a)?.order ?? UNDECLARED_CATEGORY_ORDER)
        - (declared.get(b)?.order ?? UNDECLARED_CATEGORY_ORDER))
  );
}
