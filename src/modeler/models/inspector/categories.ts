import { CHECKLIST_SPEC, StudyflowElement, isExtensionPrefix } from '@/core/extensions';
import { getCatalog, type AttributeSpec } from '@/core/catalog';
import { UNDECLARED_CATEGORY_ORDER } from '@/core/catalog/categories';
import { toLocalName } from '@/core/naming';
import { isAttributeVisible } from '@/modeler/models/inspector/attributeVisibility';
import { supportsLoopCharacteristics } from '@/modeler/models/inspector/loopCharacteristics';
import { supportsStateProperties } from '@/modeler/models/inspector/stateProperties';

/**
 * Inspector tabs, ordered as the loaded schemas declare them (each schema's
 * top-level `categories:` block; see `core/catalog/categories`). A category an
 * attribute names but no schema declares still gets a tab — it just sorts
 * after every declared one, so a schema is never *required* to declare.
 *
 * `synthetic` categories are rendered by a dedicated section component over
 * nested BPMN state (see `SECTION_BY_CATEGORY` in the view layer) rather than
 * by catalog attribute fields, so they stay in the result with no attributes.
 */
function declaredCategories(): Map<string, { order: number; synthetic: boolean }> {
  return new Map(getCatalog().categories().map((category) => [
    category.name,
    { order: category.order, synthetic: category.synthetic },
  ]));
}

/** Identity attributes (id, name) are always pinned to the top. */
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

/** Visible attribute defs grouped by category; id/name first, then BO attrs, then extension attrs. */
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

  // Schema-declared attributes render; plain BPMN natives don't. A redefine
  // that keeps BPMN's namespace (`bpmn:conditionExpression`) is still
  // schema-declared - its `redefines` marks it.
  const isDeclared = (attrDef: any) => isExtensionPrefix(attrDef.ns?.prefix) || !!attrDef.redefines;

  collect(handle.attributes(), (attrDef: any) =>
    !overridden.has(attrDef.ns?.localName ?? attrDef.name)
    && !isIdentity(attrDef)
    && isDeclared(attrDef)
  );

  collect(extAttrDefs, isDeclared);

  // `checklist` is a view over the element's `bpmn:documentation` list (its
  // `studyflow:checklist`-marked entry), not a stored attribute - synthesize
  // its field beside `documentation`.
  collect([CHECKLIST_SPEC], () => true);

  // Execution is drawn from nested BPMN state no catalog attribute reaches:
  // the `loopCharacteristics` child, the element's `bpmn:Property` children,
  // and its data associations. Any one of them is reason enough for the tab —
  // how often a step runs is part of how it runs, not a question of its own.
  if (supportsLoopCharacteristics(element) || supportsStateProperties(element)) {
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
