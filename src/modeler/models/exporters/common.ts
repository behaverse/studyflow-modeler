/**
 * Shared plumbing for the diagram exporters (ARTEM-IS, LinkML, NIDM).
 *
 * Exporters read the live bpmn-js element registry (read-only) and map
 * elements to their target format. The format mappings stay in each exporter;
 * this module owns the mechanics they all share.
 */

import { getAttribute } from '@/core/extensions';

/** Read a value through the catalog (which unwraps body-wrapped children like
 *  `bpmn:documentation`), falling back to the BO directly, moddle `get`, or
 *  its `$attrs` bag. */
export function readField(bo: any, name: string): unknown {
  if (bo == null) return undefined;
  const resolved = getAttribute(bo, name);
  if (resolved !== undefined && resolved !== null && resolved !== ''
      && typeof resolved !== 'object') return resolved;
  const direct = bo[name];
  if (direct !== undefined && direct !== null && direct !== '') return direct;
  if (typeof bo.get === 'function') {
    const v = bo.get(name);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  const attrs = bo.$attrs;
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const local = key.includes(':') ? key.split(':')[1] : key;
      if (local === name) return attrs[key];
    }
  }
  return undefined;
}

/** Walk every diagram element with a business object, skipping labels. */
export function forEachBusinessObject(modeler: any, visit: (bo: any, el: any) => void): void {
  const elementRegistry = modeler.get('elementRegistry');
  elementRegistry.forEach((el: any) => {
    if (el.type === 'label') return;
    const bo = el.businessObject;
    if (!bo) return;
    visit(bo, el);
  });
}
