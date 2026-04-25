import type { CommandContext } from './types';

/**
 * Normalize whatever the caller passed — a bpmn-js modeler, a bare modeling
 * service, or an already-shaped `CommandContext` — into a `CommandContext`.
 *
 * This lets callers use `executeCommand(modeler, …)` instead of constructing
 * a context object every time.
 */
export function normalizeContext(contextOrModeler: any): CommandContext {
  if (!contextOrModeler) return {};

  // bpmn-js modeler has .get(service)
  if (typeof contextOrModeler.get === 'function') {
    return { modeler: contextOrModeler };
  }

  // modeling service has updateProperties / updateModdleProperties
  if (
    typeof contextOrModeler.updateProperties === 'function'
    || typeof contextOrModeler.updateModdleProperties === 'function'
  ) {
    return { modeling: contextOrModeler };
  }

  return contextOrModeler;
}
