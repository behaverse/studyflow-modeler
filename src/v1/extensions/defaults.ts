/**
 * Collect default property values for a studyflow type from the moddle schema.
 * Walks `superClass` and `extends` chains via DFS, accumulating property
 * defaults along the way.
 */
export function getDefaults(
  studyflowType: string,
  moddle: any,
): Record<string, any> {
  const defaults: Record<string, any> = {};
  const seen = new Set<string>();

  const collect = (typeName: string) => {
    if (!typeName || seen.has(typeName)) return;
    seen.add(typeName);

    let descriptor: any;
    try {
      descriptor = moddle.getTypeDescriptor(typeName);
    } catch {
      return;
    }
    if (!descriptor) return;

    for (const superType of descriptor.superClass ?? []) {
      if (typeof superType === 'string') collect(superType);
    }
    for (const ext of descriptor.extends ?? []) {
      if (typeof ext === 'string') collect(ext);
    }

    for (const prop of descriptor.properties ?? []) {
      if (prop.default !== undefined) {
        defaults[prop.name] = prop.default;
      }
    }
  };

  collect(studyflowType);
  return defaults;
}
