/**
 * The bpmn backend's registration of the (now backend-neutral) token simulator.
 *
 * `TokenSimulator` takes a {@link SimulationHost} — the `events`/`elements`/`view`
 * slice of `EditorPort` — so this module is the only bpmn-shaped part left: it
 * adapts the three diagram-js services onto that shape. The canvas backend skips
 * it entirely and constructs the simulator over its own port
 * (`editor/canvasBackend.ts`).
 */

import TokenSimulator from '@modeler/simulation/TokenSimulator';
import type { SimulationHost } from '@modeler/simulation/TokenSimulator';

/** `TokenSimulator` over diagram-js's `eventBus` / `elementRegistry` / `canvas`. */
class BpmnTokenSimulator extends TokenSimulator {
  static $inject = ['eventBus', 'elementRegistry', 'canvas'];

  constructor(eventBus: any, elementRegistry: any, canvas: any) {
    const host: SimulationHost = {
      events: eventBus,
      elements: {
        filter: (fn) => elementRegistry.filter(fn),
        root: () => canvas.getRootElement(),
        findRoot: (element) => canvas.findRoot(element) ?? undefined,
      },
      view: {
        getLayer: (name, index) => canvas.getLayer(name, index),
      },
    };
    super(host);
  }
}

export default {
  __init__: ['tokenSimulator'],
  tokenSimulator: ['type', BpmnTokenSimulator],
};
