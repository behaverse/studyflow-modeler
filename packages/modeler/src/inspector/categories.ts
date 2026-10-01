import { getAttributeSpec } from '@core/element';
import { isExtensionPrefix, readAttribute, type Element, type StudyModel } from '@core/model/index';
import { getCatalog, UNDECLARED_CATEGORY_ORDER, type AttributeSpec } from '@core/notation';
import { toLocalName } from '@core/naming';
import { supportsLoopCharacteristics } from '@modeler/inspector/loopCharacteristics';
import { isScopeContainer } from '@modeler/inspector/stateProperties';

export function isAttributeVisible(model: StudyModel, attrDef: AttributeSpec | undefined, element: Element | undefined): boolean {
  if (!attrDef || !element) return true;
  if (attrDef.meta?.pinned) return false;
  if (!attrDef.meta?.condition) return true;

  const conditions = attrDef.meta.condition;
  const matches = (actual: unknown, expected: unknown): boolean => {
    if (expected === '$set') return actual != null && actual !== '';
    if (Array.isArray(expected)) return expected.includes(actual);
    if (expected && typeof expected === 'object' && '$not' in expected) return !matches(actual, (expected as { $not: unknown }).$not);
    return actual === expected;
  };
  return Object.entries(conditions).every(([key, expected]) => matches(readAttribute(model, element, key), expected));
}

/** The tabs an attribute files under: the ones it names, else its schema's default (`TypeCatalog.defaultCategoryOf`). */
export function categoriesOf(attrDef: AttributeSpec): string[] {
  return attrDef.meta?.categories ?? [getCatalog().defaultCategoryOf(attrDef.ns?.prefix)];
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

export function getAttributesByCategory(model: StudyModel, element: Element): Record<string, AttributeSpec[]> {
  const byCategory: Record<string, AttributeSpec[]> = {};
  const host = model.host(element);
  const extensionType = model.extensionType(element);
  const extAttrDefs = extensionType ? getCatalog().instanceAttributesOf(extensionType) : [];
  const seen = new Set<string>();

  const overridden = new Set(
    extAttrDefs
      .map((attrDef) => attrDef.redefinedName ?? attrDef.ns?.localName ?? attrDef.name)
      .filter((name): name is string => Boolean(name))
  );

  const identity = [
    getAttributeSpec(host, 'bpmn:id'),
    getAttributeSpec(host, 'bpmn:name'),
  ].filter((d): d is AttributeSpec => Boolean(d));

  const collect = (attrDefs: readonly AttributeSpec[], predicate: (attrDef: AttributeSpec) => boolean) => {
    attrDefs.forEach((attrDef) => {
      if (!predicate(attrDef)) return;
      if (!isAttributeVisible(model, attrDef, element)) return;

      const key = attrDef.ns?.name ?? attrDef.name;
      if (seen.has(key)) return;
      seen.add(key);

      categoriesOf(attrDef).forEach((category: string) => {
        (byCategory[category] ??= []).push(attrDef);
      });
    });
  };

  collect(identity, () => true);

  // Schema-declared attributes render; plain BPMN natives don't.
  const isDeclared = (attrDef: AttributeSpec) => isExtensionPrefix(attrDef.ns?.prefix) || !!attrDef.redefines;

  collect(getCatalog().instanceAttributesOf(host), (attrDef: AttributeSpec) =>
    !overridden.has(attrDef.ns?.localName ?? attrDef.name)
    && !isIdentity(attrDef)
    && isDeclared(attrDef)
  );

  collect(extAttrDefs, isDeclared);

  if (supportsLoopCharacteristics(model, element) || isScopeContainer(model, element)) {
    byCategory['Execution'] ??= [];
  }

  // Identity sorts as order 0: after a negative order, before every other.
  const orderOf = (attrDef: AttributeSpec) => (identity.includes(attrDef) ? 0 : attrDef.meta?.order ?? Infinity);
  for (const attrDefs of Object.values(byCategory)) {
    attrDefs.sort((a, b) => orderOf(a) - orderOf(b));
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
