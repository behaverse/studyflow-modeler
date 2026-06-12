import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import {
  getAttributeDefinition,
  getAttributeDefinitions,
  getExtensionAttributeDefinitions,
  getRedefinedName,
  isExtensionPrefix,
} from '@/lib/core/extensions';
import { toLocalName } from '@/lib/core/utils/naming';
import { isAttributeVisible } from './field';

/** Canonical tab order; unlisted categories follow in insertion order. */
const CATEGORY_ORDER = [
  'General',
  'Documentation',
  'Gantt',
  'Content',
  'Data',
  'Execution',
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
function isIdentity(attrDef: any): boolean {
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
export function getAttributesByCategory(element: any): Record<string, any[]> {
  const byCategory: Record<string, any[]> = {};
  const bo = getBusinessObject(element);
  const extAttrDefs = getExtensionAttributeDefinitions(element);
  const seen = new Set<string>();

  const overridden = new Set(
    extAttrDefs
      .map((attrDef: any) => getRedefinedName(attrDef) ?? attrDef.ns?.localName ?? attrDef.name)
      .filter((name: string | undefined): name is string => Boolean(name))
  );

  const identity = [
    getAttributeDefinition(bo, 'bpmn:id'),
    getAttributeDefinition(bo, 'bpmn:name'),
  ].filter(Boolean);

  const collect = (attrDefs: any[], predicate: (attrDef: any) => boolean) => {
    attrDefs.forEach((attrDef: any) => {
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

  collect(getAttributeDefinitions(bo), (attrDef: any) =>
    !overridden.has(attrDef.ns?.localName ?? attrDef.name)
    && !isIdentity(attrDef)
    && isExtensionPrefix(attrDef.ns?.prefix)
  );

  collect(extAttrDefs, (attrDef: any) => isExtensionPrefix(attrDef.ns?.prefix));

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
      .filter(([, v]) => v.length > 0)
      .sort(([a], [b]) => orderIndex(a) - orderIndex(b))
  );
}
