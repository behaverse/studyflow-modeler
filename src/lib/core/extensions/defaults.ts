/** Default attribute values for a type, walking the `superClass` and `extends` chains. */
export function getDefaults(typeName: string, moddle: any): Record<string, any> {
  const defaults: Record<string, any> = {};
  const seen = new Set<string>();

  const collect = (name: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);

    let typeDef: any;
    try { typeDef = moddle.getTypeDescriptor(name); } catch { return; }
    if (!typeDef) return;

    for (const s of typeDef.superClass ?? []) if (typeof s === 'string') collect(s);
    for (const e of typeDef.extends ?? []) if (typeof e === 'string') collect(e);

    for (const attrDef of typeDef.properties ?? []) {
      if (attrDef.default !== undefined) defaults[attrDef.name] = attrDef.default;
    }
  };

  collect(typeName);
  return defaults;
}
