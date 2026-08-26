import type { Modeler, ServiceResolver } from '@modeler/bpmn/types';
import { modelingUpdater } from '@modeler/bpmn/modeling';
import type {
  EditorEventListener,
  EditorModel,
  EditorPort,
  Viewbox,
} from '@modeler/editor/port';

/**
 * The `EditorModel` slice on its own, built from any service resolver — the
 * command bus hands some call paths a didi injector rather than the modeler
 * (e.g. `buildBusinessObject` from the append menu), and those only need the
 * document-model surface.
 */
export function createEditorModel(resolver: ServiceResolver): EditorModel {
  const moddle = () => resolver.get('moddle');
  return {
    moddle: () => moddle(),
    create: (type, properties) => (moddle() as any).create(type, properties),
    createBusinessObject: (type, properties) => resolver.get('bpmnFactory').create(type, properties),
    fromXML: (xml) => moddle().fromXML(xml),
    toXML: (definitions, options) => moddle().toXML(definitions, options),
    ids: {
      // `ids` is untyped upstream (same cast as `buildBusinessObject`).
      nextPrefixed: (prefix, element) => (moddle() as any).ids.nextPrefixed(prefix, element),
      assigned: (id) => (moddle() as any).ids.assigned(id),
    },
  };
}

/**
 * bpmn-js implementation of `EditorPort`: thin delegation onto the modeler's DI
 * services. Create one adapter per modeler instance (see `getEditorPort`) so the
 * revision counter spans the modeler's whole life.
 */
export function createBpmnEditorPort(modeler: Modeler): EditorPort {
  let revision = 0;
  // `importXML` clears the command stack without firing `commandStack.changed`,
  // so the counter only moves on real edits/undo/redo — the same signal as the
  // `commandStack._stackIdx` read it replaces. Non-strict: unit-test modeler
  // stand-ins carry no event bus (and no edits to count).
  modeler.get('eventBus', false)?.on('commandStack.changed', () => {
    revision += 1;
  });

  const canvas = () => modeler.get('canvas');
  const modeling = () => modeler.get('modeling');
  const registry = () => modeler.get('elementRegistry');

  return {
    revision: () => revision,
    undo: () => modeler.get('commandStack').undo(),
    redo: () => modeler.get('commandStack').redo(),
    // Non-strict: read at render time, where a stand-in may carry no command stack.
    canUndo: () => !!modeler.get('commandStack', false)?.canUndo(),
    canRedo: () => !!modeler.get('commandStack', false)?.canRedo(),

    importXML: (xml) => modeler.importXML(xml),
    saveXML: (options) => modeler.saveXML(options),
    saveSVG: () => modeler.saveSVG(),
    getDefinitions: () => modeler.getDefinitions?.(),

    elements: {
      get: (id) => registry().get(id),
      forEach: (fn) => registry().forEach(fn),
      filter: (fn) => registry().filter(fn),
      root: () => canvas().getRootElement(),
      findRoot: (element) => canvas().findRoot(element) ?? undefined,
      getGraphics: (element) => registry().getGraphics(element),
    },

    view: {
      zoom: () => canvas().zoom(),
      zoomToFit: () => {
        canvas().zoom('fit-viewport');
      },
      viewbox: () => canvas().viewbox() as Viewbox,
      setViewbox: (box) => {
        canvas().viewbox(box);
      },
      getAbsoluteBBox: (element) => canvas().getAbsoluteBBox(element),
      getContainer: () => canvas().getContainer(),
      getLayer: (name, index) => canvas().getLayer(name, index),
      addMarker: (elementOrId, marker) => canvas().addMarker(elementOrId, marker),
      removeMarker: (elementOrId, marker) => canvas().removeMarker(elementOrId, marker),
      scrollToElement: (element, padding) => canvas().scrollToElement(element, padding),
    },

    mutate: {
      setColor: (elements, colors) => {
        // Upstream types omit `null`, which `setColor` accepts at runtime to clear a color.
        modeling().setColor(elements, colors as any);
      },
      updateProperties: (element, properties) => {
        modeling().updateProperties(element, properties);
      },
      update: (element, target, properties) => {
        modelingUpdater(modeling()).update(element, target, properties);
      },
      updateModdleProperties: (element, moddleElement, properties) => {
        modeling().updateModdleProperties(element, moddleElement, properties);
      },
      resizeShape: (shape, bounds) => {
        modeling().resizeShape(shape, bounds);
      },
      createShape: (shape, position, parent, hints) => modeling().createShape(shape, position, parent, hints),
      createConnection: (source, target, connection, parent, hints) =>
        modeling().createConnection(source, target, connection, parent, hints),
    },

    selection: {
      get: () => modeler.get('selection').get(),
      select: (elements, add) => {
        modeler.get('selection').select(elements, add);
      },
    },

    events: {
      // Non-strict lookups: React effects detach after StrictMode teardown, when
      // the bus may already be gone.
      on: (topic: string, priorityOrListener: number | EditorEventListener, listener?: EditorEventListener) => {
        const bus = modeler.get('eventBus', false);
        if (!bus) return;
        if (typeof priorityOrListener === 'number') bus.on(topic, priorityOrListener, listener!);
        else bus.on(topic, priorityOrListener);
      },
      off: (topic, listener) => {
        modeler.get('eventBus', false)?.off(topic, listener);
      },
      fire: (topic, payload) => {
        modeler.get('eventBus', false)?.fire(topic, payload);
      },
    },

    rules: {
      allowed: (action, context) => !!modeler.get('rules').allowed(action, context),
    },

    gestures: {
      createShape: (attrs) => modeler.get('elementFactory').createShape(attrs),
      startCreate: (event, elements, context) => {
        modeler.get('create').start(event, elements, context);
      },
      startLasso: (event) => {
        modeler.get('lassoTool').activateSelection(event);
      },
      // Without a primed hover the dragger draws no CreatePreview until the next mouse move.
      primeHover: (event) => {
        if (!event || typeof event.clientX !== 'number') return;
        const rootElement = canvas().getRootElement();
        const gfx = registry().getGraphics(rootElement);
        const dragging = modeler.get('dragging');
        dragging.hover({ element: rootElement, gfx });
        dragging.move(event);
      },
    },

    popup: {
      open: (providerId, position, options) => {
        // `popupMenu.open` types its target more narrowly than the `RootLike` it accepts.
        const rootElement = canvas().getRootElement() as any;
        modeler.get('popupMenu').open(rootElement, providerId, position, options);
      },
    },

    model: createEditorModel(modeler),

    templates: {
      getAll: () => modeler.get('elementTemplates').getAll(),
      createElement: (template) => modeler.get('elementTemplates').createElement(template),
    },

    simulation: {
      toggle: () => {
        modeler.get('tokenSimulator').toggle();
      },
      isActive: () => modeler.get('tokenSimulator').isActive(),
    },
  };
}

const ports = new WeakMap<Modeler, EditorPort>();

/**
 * The `EditorPort` for a modeler instance — memoized so every consumer shares
 * one adapter (and one revision counter) per modeler. `app/Modeler.tsx` primes
 * this at creation; app code holding either the modeler handle or the
 * `ModelerContext` value reaches the facade through it.
 */
export function getEditorPort(modeler: Modeler): EditorPort {
  let port = ports.get(modeler);
  if (!port) {
    port = createBpmnEditorPort(modeler);
    ports.set(modeler, port);
  }
  return port;
}
