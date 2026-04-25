import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import {
  getBusinessObjectPropertyDescriptor,
  getElementProperties,
  getExtensionElementProperties,
  getRedefinedPropertyName,
  isExtensionPrefix,
} from '../extensions';
import { toLocalName } from '../utils/naming';
import { isPropertyVisible } from './field';

/** A property is "identity-like" (id or name) and should always show up first. */
export function isIdentityProperty(prop: any): boolean {
  const name = prop?.ns?.name ?? prop?.name;
  const localName = prop?.ns?.localName ?? toLocalName(name);
  return (
    prop?.isId
    || name === 'bpmn:id'
    || name === 'bpmn:name'
    || localName === 'id'
    || localName === 'name'
  );
}

/**
 * Collect the visible properties of an element grouped by category.
 *
 * Ordering rules:
 * - `id` and `name` descriptors on the business object are always shown first.
 * - Extension-prefixed business-object properties follow, minus ones that
 *   are redefined by the extension element.
 * - Extension element properties go last; within each category, items are
 *   sorted by `meta.order` (unset orders keep relative position).
 *
 * Empty categories are pruned from the result.
 */
export function getProperties(element: any): Record<string, any[]> {
  const propsByCategory: Record<string, any[]> = {};
  const businessObject = getBusinessObject(element);
  const extensionProperties = getExtensionElementProperties(element);
  const seen = new Set<string>();

  const overriddenBusinessProperties = new Set(
    extensionProperties
      .map((prop: any) => getRedefinedPropertyName(prop) ?? prop.ns?.localName ?? prop.name)
      .filter((name: string | undefined): name is string => Boolean(name))
  );

  const identityProperties = [
    getBusinessObjectPropertyDescriptor(businessObject, 'bpmn:id'),
    getBusinessObjectPropertyDescriptor(businessObject, 'bpmn:name'),
  ].filter((prop: any) => Boolean(prop));

  const collect = (properties: any[], predicate: (prop: any) => boolean) => {
    properties.forEach((prop: any) => {
      if (!predicate(prop)) return;
      if (!isPropertyVisible(prop, element)) return;

      const propKey = prop.ns?.name ?? prop.name;
      if (seen.has(propKey)) return;
      seen.add(propKey);

      (prop.meta?.categories ?? ['General']).forEach((cat: string) => {
        (propsByCategory[cat] ??= []).push(prop);
      });
    });
  };

  collect(identityProperties, () => true);

  collect(getElementProperties(businessObject), (prop: any) =>
    !overriddenBusinessProperties.has(prop.ns?.localName ?? prop.name)
    && !isIdentityProperty(prop)
    && isExtensionPrefix(prop.ns?.prefix)
  );

  collect(extensionProperties, (prop: any) => isExtensionPrefix(prop.ns?.prefix));

  // Sort by meta.order within each category
  for (const props of Object.values(propsByCategory)) {
    props.sort((a: any, b: any) => {
      const orderA = a.meta?.order ?? Infinity;
      const orderB = b.meta?.order ?? Infinity;
      return orderA - orderB;
    });
  }

  return Object.fromEntries(
    Object.entries(propsByCategory).filter(([, v]) => v.length > 0)
  );
}

/** Stable signature of the property set, used to detect render-worthy changes. */
export function getCategoriesSignature(categories: Record<string, any[]>): string {
  return Object.entries(categories)
    .map(([catName, props]) => `${catName}:${props.map((p: any) => p.ns.name).join(',')}`)
    .join('|');
}
