/** Boot order: `loader` parses the YAML once → `loadSchemas` filters → `buildCatalog` → `setCatalog`; every other module reads `getCatalog`. */

export * from '@behaverse/studyflow-core/notation/types';
export { buildCatalog } from '@behaverse/studyflow-core/notation/compile';
// Type-only: `buildCatalog` is the sole way to make one, so `register` stays out of reach.
export type { TypeCatalog } from '@behaverse/studyflow-core/notation/query';
export { HIDDEN_SCHEMA_TYPES } from '@behaverse/studyflow-core/notation/palette';
export { BPMN_ANCESTORS, bpmnSelfAndAncestors, isBpmnSubtypeOf } from '@behaverse/studyflow-core/notation/bpmn';

import { BPMN_NS } from '@behaverse/studyflow-core/constants';
import { TypeCatalog } from '@behaverse/studyflow-core/notation/query';

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
