import { StudyflowElement, isExtensionPrefix } from '@/core/extensions';
import type { AttributeSpec } from '@/core/catalog';
import { toLocalName } from '@/core/naming';
import { isAttributeVisible } from '@/modeler/models/inspector/attributeVisibility';
import { supportsLoopCharacteristics } from '@/modeler/models/inspector/loopCharacteristics';

/** Categories rendered by a dedicated section component over nested model
 *  state (see `SECTION_BY_CATEGORY` in the view layer), not by catalog
 *  attribute fields; they stay in the result even with no attributes. */
const SYNTHETIC_CATEGORIES = new Set(['Loop']);

/** Canonical tab order; unlisted categories follow in insertion order. */
const CATEGORY_ORDER = [
  'General',
  'Documentation',
  'Gantt',
  'Content',
  'Data',
  'Execution',
  'Loop',
  'Instrument',
  'Behaverse',
  'DataTrove',
  'fMRIPrep',
  'EEGPrep',
  'Assignment',
  'Eligibility',
  'Privacy',
  'Control',
  'Completion',
];

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

  collect(handle.attributes(), (attrDef: any) =>
    !overridden.has(attrDef.ns?.localName ?? attrDef.name)
    && !isIdentity(attrDef)
    && isExtensionPrefix(attrDef.ns?.prefix)
  );

  collect(extAttrDefs, (attrDef: any) => isExtensionPrefix(attrDef.ns?.prefix));

  // The Loop tab edits the `loopCharacteristics` child, which has no
  // catalog attributes on the element itself.
  if (supportsLoopCharacteristics(element)) byCategory['Loop'] ??= [];

  for (const attrDefs of Object.values(byCategory)) {
    attrDefs.sort((a: any, b: any) => {
      const orderA = a.meta?.order ?? Infinity;
      const orderB = b.meta?.order ?? Infinity;
      return orderA - orderB;
    });
  }

  const orderIndex = (category: string) => {
    const i = CATEGORY_ORDER.indexOf(category);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  return Object.fromEntries(
    Object.entries(byCategory)
      .filter(([name, v]) => v.length > 0 || SYNTHETIC_CATEGORIES.has(name))
      .sort(([a], [b]) => orderIndex(a) - orderIndex(b))
  );
}
