import { toLocalName } from '../utils/naming';

const PRIMITIVE_SUPER_CLASSES = new Set(['Element', 'BaseElement', 'String', 'Boolean', 'Integer', 'Float', 'Double']);

export function resolveBpmnCreateType(moddle: any, typeRefOrDescriptor: any): string | null {
  const descriptor = typeof typeRefOrDescriptor === 'string'
    ? resolveTypeDescriptor(moddle, typeRefOrDescriptor)
    : typeRefOrDescriptor;

  if (!descriptor) {
    return null;
  }

  return resolveDescriptorBpmnType(moddle, descriptor, new Set<string>());
}

function resolveDescriptorBpmnType(moddle: any, descriptor: any, seen: Set<string>): string | null {
  const descriptorId = descriptorKey(descriptor);
  if (seen.has(descriptorId)) {
    return null;
  }

  seen.add(descriptorId);

  // Custom convention: a type with `meta.bpmnType` (e.g. "bpmn:Task") declares the BPMN element it attaches to as an extension. 
  const bpmnType = descriptor?.meta?.bpmnType;
  if (typeof bpmnType === 'string' && bpmnType.startsWith('bpmn:')) {
    return bpmnType;
  }

  if (Array.isArray(descriptor.extends) && descriptor.extends.length > 0) {
    for (const extended of descriptor.extends) {
      if (typeof extended === 'string' && extended.startsWith('bpmn:')) {
        return extended;
      }
      const extendedDescriptor = resolveTypeDescriptor(moddle, extended, descriptor.ns?.prefix);
      if (extendedDescriptor) {
        const resolved = resolveDescriptorBpmnType(moddle, extendedDescriptor, seen);
        if (resolved) return resolved;
      }
    }
  }

  if (descriptor.ns?.prefix === 'bpmn' && descriptor.name) {
    return `bpmn:${descriptor.name}`;
  }

  for (const superType of descriptor.superClass ?? []) {
    const localName = toLocalName(superType) ?? superType;
    if (PRIMITIVE_SUPER_CLASSES.has(localName)) {
      continue;
    }

    if (typeof superType === 'string' && superType.startsWith('bpmn:')) {
      return superType;
    }

    const parentDescriptor = resolveTypeDescriptor(moddle, superType, descriptor.ns?.prefix);
    if (!parentDescriptor) {
      continue;
    }

    const resolved = resolveDescriptorBpmnType(moddle, parentDescriptor, seen);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function resolveTypeDescriptor(moddle: any, typeRef: string, ownerPrefix?: string): any {
  const typeMap: Record<string, any> = moddle?.registry?.typeMap ?? {};
  const localName = toLocalName(typeRef) ?? typeRef;
  const candidates = [
    typeRef,
    ownerPrefix && !typeRef.includes(':') ? `${ownerPrefix}:${typeRef}` : null,
    !typeRef.startsWith('bpmn:') ? `bpmn:${localName}` : null,
    localName,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (typeMap[candidate]) {
      return typeMap[candidate];
    }
  }

  for (const candidate of candidates) {
    try {
      return moddle.getTypeDescriptor(candidate);
    } catch {
      // Continue.
    }
  }

  return null;
}

function descriptorKey(descriptor: any): string {
  if (typeof descriptor?.ns?.name === 'string' && descriptor.ns.name.length > 0) {
    return descriptor.ns.name;
  }

  if (typeof descriptor?.name === 'string' && descriptor.name.length > 0) {
    return descriptor.name;
  }

  return String(descriptor);
}

