export * from '@/core/catalog/types';
export { buildCatalog, TypeCatalog } from '@/core/catalog/compile';
export { HIDDEN_SCHEMA_TYPES } from '@/core/catalog/palette';
export { BPMN_ANCESTORS, bpmnSelfAndAncestors, isBpmnSubtypeOf } from '@/core/catalog/bpmn';

import { buildCatalog, TypeCatalog } from '@/core/catalog/compile';

let activeCatalog: TypeCatalog = buildCatalog([]);

/** Install the catalog compiled from the currently loaded schemas. */
export function setCatalog(catalog: TypeCatalog): void {
  activeCatalog = catalog;
}

/**
 * The catalog for the currently loaded schemas. Empty until `loadSchemas`
 * has run (callers all sit behind the modeler/runner bootstrap, which loads
 * schemas first).
 */
export function getCatalog(): TypeCatalog {
  return activeCatalog;
}
