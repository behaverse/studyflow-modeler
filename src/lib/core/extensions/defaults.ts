// Collect default property values for a type by walking `superClass` and
// `extends` chains via DFS and accumulating `default` along the way.
export function getDefaults(typeName: string, moddle: any): Record<string, any> {
  const defaults: Record<string, any> = {};
  const seen = new Set<string>();

  const collect = (name: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);

    let descriptor: any;
    try { descriptor = moddle.getTypeDescriptor(name); } catch { return; }
    if (!descriptor) return;

    for (const s of descriptor.superClass ?? []) if (typeof s === 'string') collect(s);
    for (const e of descriptor.extends ?? []) if (typeof e === 'string') collect(e);

    for (const prop of descriptor.properties ?? []) {
      if (prop.default !== undefined) defaults[prop.name] = prop.default;
    }
  };

  collect(typeName);
  return defaults;
}
