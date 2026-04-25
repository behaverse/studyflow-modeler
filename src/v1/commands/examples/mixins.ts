import { splitQName } from '../../utils/naming';

/**
 * Look up a moddle type descriptor by a (potentially partial) type ref,
 * falling back to the package prefix if the ref is unqualified.
 */
export function resolveTypeDescriptor(moddle: any, typeRef: string, prefix: string): any {
  const typeMap: Record<string, any> = moddle.registry.typeMap;
  const { localName } = splitQName(typeRef);
  const fallback = localName ?? typeRef;
  const candidates = [typeRef, `${prefix}:${fallback}`, fallback];

  for (const candidate of candidates) {
    if (typeMap[candidate]) {
      return typeMap[candidate];
    }
  }

  try {
    return moddle.getTypeDescriptor(typeRef);
  } catch {
    return undefined;
  }
}

/** Collect `default` values declared on a moddle type descriptor's properties. */
export function getDefaultProperties(typeDescriptor: any): Record<string, any> {
  const defaults: Record<string, any> = {};

  for (const property of typeDescriptor?.properties ?? []) {
    if (property.default !== undefined) {
      defaults[property.name] = property.default;
    }
  }

  return defaults;
}

/**
 * Resolve a mixin chain declared on an example object. Each referenced
 * mixin contributes its default properties, and a `bpmn:*` mixin additionally
 * overrides the resolved BPMN type.
 */
export function resolveExampleMixins(
  moddle: any,
  obj: Record<string, any>,
  prefix: string,
): {
  bpmnTypeOverride?: string;
  properties: Record<string, any>;
} {
  const mixins = Array.isArray(obj.mixins) ? obj.mixins : [];
  const properties: Record<string, any> = {};
  let bpmnTypeOverride: string | undefined;

  for (const mixinRef of mixins) {
    if (typeof mixinRef !== 'string' || mixinRef.trim() === '') {
      continue;
    }

    const descriptor = resolveTypeDescriptor(moddle, mixinRef, prefix);
    if (!descriptor) {
      console.warn(`[examples-loader] Unable to resolve mixin '${mixinRef}'`);
      continue;
    }

    Object.assign(properties, getDefaultProperties(descriptor));

    if (mixinRef.startsWith('bpmn:')) {
      bpmnTypeOverride = mixinRef;
    }
  }

  return { bpmnTypeOverride, properties };
}

/** Keep only keys not in `reservedKeys`, dropping `undefined` values. */
export function extractProperties(
  obj: Record<string, any>,
  reservedKeys: Set<string>,
): Record<string, any> {
  const properties: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (!reservedKeys.has(key) && value !== undefined) {
      properties[key] = value;
    }
  }

  return properties;
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
