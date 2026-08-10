/** Boot order: `loader` parses the YAML once → `loadSchemas` filters → `buildCatalog` → `setCatalog`; every other module reads `getCatalog`. */

export * from '@/core/notation/types';
export { buildCatalog } from '@/core/notation/compile';
// Type-only: `buildCatalog` is the sole way to make one, so `register` stays out of reach.
export type { TypeCatalog } from '@/core/notation/query';
export { HIDDEN_SCHEMA_TYPES } from '@/core/notation/palette';
export { BPMN_ANCESTORS, bpmnSelfAndAncestors, isBpmnSubtypeOf } from '@/core/notation/bpmn';

import { BPMN_NS } from '@/core/constants';
import { TypeCatalog } from '@/core/notation/query';

let activeCatalog: TypeCatalog | undefined;

export function setCatalog(catalog: TypeCatalog): void {
  activeCatalog = catalog;
}

/** Throws until `loadSchemas` has installed a catalog: an empty one would answer every
 *  query with silent undefined/[] — a blank palette and dropped attributes, far from the cause. */
export function getCatalog(): TypeCatalog {
  if (!activeCatalog) {
    throw new Error('getCatalog() before loadSchemas(): no schemas are installed yet.');
  }
  return activeCatalog;
}

/** Whether a catalog is installed, for callers that legitimately run before boot. */
export function hasCatalog(): boolean {
  return activeCatalog !== undefined;
}

/** Compile diagnostics for the installed schemas; empty before boot. */
export function schemaDiagnostics(): string[] {
  return activeCatalog?.diagnostics ?? [];
}

export function namespaces(): { bpmn: string; core: string } {
  const core = getCatalog().schemas.find((schema) => schema.core);
  return {
    bpmn: BPMN_NS,
    core: core?.uri ?? '',
  };
}
