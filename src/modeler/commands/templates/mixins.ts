import { splitQName } from '@/lib/core/utils/naming';

/** Look up a moddle type definition; falls back to the package prefix when the ref is unqualified. */
export function resolveTypeSchema(moddle: any, typeRef: string, prefix: string): any {
  const typeMap: Record<string, any> = moddle.registry.typeMap;
  const { localName } = splitQName(typeRef);
  const fallback = localName ?? typeRef;

  for (const candidate of [typeRef, `${prefix}:${fallback}`, fallback]) {
    if (typeMap[candidate]) return typeMap[candidate];
  }

  try { return moddle.getTypeDescriptor(typeRef); } catch { return undefined; }
}

function collectDefaults(typeDef: any): Record<string, any> {
  const defaults: Record<string, any> = {};
  for (const attrDef of typeDef?.properties ?? []) {
    if (attrDef.default !== undefined) defaults[attrDef.name] = attrDef.default;
  }
  return defaults;
}

/** Resolve a `mixins:` chain; each contributes defaults, `bpmn:*` mixins override the BPMN type. */
export function resolveTemplateMixins(
  moddle: any,
  definition: Record<string, any>,
  prefix: string,
): { bpmnTypeOverride?: string; attributes: Record<string, any> } {
  const mixins = Array.isArray(definition.mixins) ? definition.mixins : [];
  const attrs: Record<string, any> = {};
  let bpmnTypeOverride: string | undefined;

  for (const mixinRef of mixins) {
    if (typeof mixinRef !== 'string' || mixinRef.trim() === '') continue;

    const typeDef = resolveTypeSchema(moddle, mixinRef, prefix);
    if (!typeDef) {
      console.warn(`[templates-loader] Unable to resolve mixin '${mixinRef}'`);
      continue;
    }

    Object.assign(attrs, collectDefaults(typeDef));
    if (mixinRef.startsWith('bpmn:')) bpmnTypeOverride = mixinRef;
  }

  return { bpmnTypeOverride, attributes: attrs };
}

/** Keep only keys not in `reservedKeys`, dropping `undefined` values. */
export function extractAttributes(definition: Record<string, any>, reservedKeys: Set<string>): Record<string, any> {
  const attributes: Record<string, any> = {};
  for (const [key, value] of Object.entries(definition)) {
    if (!reservedKeys.has(key) && value !== undefined) attributes[key] = value;
  }
  return attributes;
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
