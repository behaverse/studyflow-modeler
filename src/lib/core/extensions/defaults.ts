import { getActiveCatalog } from '../catalog';

/** Default attribute values for a schema type, across its inheritance chain. */
export function getDefaults(typeName: string): Record<string, any> {
  return { ...getActiveCatalog().defaultsOf(typeName) };
}
