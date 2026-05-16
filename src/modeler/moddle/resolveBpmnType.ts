import { toLocalName } from '@/lib/core/utils/naming';

const PRIMITIVE_SUPER_CLASSES = new Set(['Element', 'BaseElement', 'String', 'Boolean', 'Integer', 'Float', 'Double']);

export function resolveBpmnCreateType(moddle: any, typeRefOrSchema: any): string | null {
  const typeDef = typeof typeRefOrSchema === 'string'
    ? resolveTypeSchema(moddle, typeRefOrSchema)
    : typeRefOrSchema;
  if (!typeDef) return null;
  return walkForBpmnType(moddle, typeDef, new Set<string>());
}

function walkForBpmnType(moddle: any, typeDef: any, seen: Set<string>): string | null {
  const id = typeDef?.ns?.name || typeDef?.name || String(typeDef);
  if (seen.has(id)) return null;
  seen.add(id);

  // Studyflow convention: `meta.bpmnType` (e.g. "bpmn:Task") declares the attach point.
  const metaBpmn = typeDef?.meta?.bpmnType;
  if (typeof metaBpmn === 'string' && metaBpmn.startsWith('bpmn:')) return metaBpmn;

  for (const extended of typeDef.extends ?? []) {
    if (typeof extended === 'string' && extended.startsWith('bpmn:')) return extended;
    const extendedSchema = resolveTypeSchema(moddle, extended, typeDef.ns?.prefix);
    if (!extendedSchema) continue;
    const resolved = walkForBpmnType(moddle, extendedSchema, seen);
    if (resolved) return resolved;
  }

  if (typeDef.ns?.prefix === 'bpmn' && typeDef.name) return `bpmn:${typeDef.name}`;

  for (const superType of typeDef.superClass ?? []) {
    const localName = toLocalName(superType) ?? superType;
    if (PRIMITIVE_SUPER_CLASSES.has(localName)) continue;
    if (typeof superType === 'string' && superType.startsWith('bpmn:')) return superType;

    const parentSchema = resolveTypeSchema(moddle, superType, typeDef.ns?.prefix);
    if (!parentSchema) continue;
    const resolved = walkForBpmnType(moddle, parentSchema, seen);
    if (resolved) return resolved;
  }

  return null;
}

function resolveTypeSchema(moddle: any, typeRef: string, ownerPrefix?: string): any {
  const typeMap: Record<string, any> = moddle?.registry?.typeMap ?? {};
  const localName = toLocalName(typeRef) ?? typeRef;
  const candidates = [
    typeRef,
    ownerPrefix && !typeRef.includes(':') ? `${ownerPrefix}:${typeRef}` : null,
    !typeRef.startsWith('bpmn:') ? `bpmn:${localName}` : null,
    localName,
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    if (typeMap[candidate]) return typeMap[candidate];
  }
  for (const candidate of candidates) {
    try { return moddle.getTypeDescriptor(candidate); } catch { /* try next */ }
  }
  return null;
}
