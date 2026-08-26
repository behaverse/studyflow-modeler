/**
 * The native-canvas backend: `@behaverse/studyflow-canvas` plus the halves the
 * canvas deliberately does not own (design §4 EDITORPORT MAPPING, "(A)").
 *
 * The canvas is a leaf package — no bpmn-js, no `@modeler/*` — so everything
 * schema-, document- or app-chrome-shaped is assembled here and injected:
 *
 * - **model** — a bare `bpmn-moddle` carrying the enabled extension schemas. It is
 *   the document model on *both* backends, which is what makes `importXML` /
 *   `saveXML` byte-comparable across the switch. Id bookkeeping delegates to the
 *   canvas writeback's own {@link IdGenerator}, so palette-minted ids and
 *   writeback-minted ids draw from one pool.
 * - **history** — the app snapshot store (`editor/history.ts`). The canvas has no
 *   command stack, so every mutation — through `mutate.*` *or* through a direct
 *   canvas gesture (drag, create, delete, inline rename) — is recorded here, and
 *   undo/redo replay a snapshot back into the canvas.
 * - **popup** — app chrome (`editor/popupMenus.ts`); the canvas contributes only
 *   anchor geometry.
 * - **templates / simulation** — app services, unchanged in intent from the bpmn
 *   backend's DI-provided ones.
 */

import { BpmnModdle } from 'bpmn-moddle';
import { Canvas, IdGenerator, createCanvasEditorPort, defaultSizeFor, prefixFor } from '@canvas/index.ts';
import type { IconDef } from '@canvas/index.ts';
import { getCatalog } from '@core/notation';
import { StudyflowElement, getRawAttribute } from '@core/element';
import { BPMN_ICON_OVERRIDES, MARKER_ICONS, SVG_ICON_PATHS } from '@modeler/draw/icons';
import { createSnapshotHistory } from '@modeler/editor/history';
import { openPopupMenu } from '@modeler/editor/popupMenus';
import Templates, { TEMPLATE_FLOW_ELEMENTS } from '@modeler/templates/Templates';
import { materializeTemplateFlow } from '@modeler/templates/factory';
import type { EditorModel, EditorPort, ModelElement } from '@modeler/editor/port';
import type { PortHandle } from '@modeler/editor/registry';

export type CanvasBackendOptions = {
  container: HTMLElement;
  extensionSchemas: Record<string, any>;
};

/**
 * The moddle types bpmn-js's `BpmnFactory` mints ids for. Mirrored so a business
 * object built through `EditorModel.createBusinessObject` carries the same id on
 * either backend (`ExtensionElements` and friends stay id-less, as upstream).
 */
const ID_BEARING_TYPES = [
  'bpmn:RootElement',
  'bpmn:FlowElement',
  'bpmn:MessageFlow',
  'bpmn:DataAssociation',
  'bpmn:Artifact',
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:LaneSet',
  'bpmn:Process',
  'bpmn:Collaboration',
  'bpmndi:BPMNShape',
  'bpmndi:BPMNEdge',
  'bpmndi:BPMNDiagram',
  'bpmndi:BPMNPlane',
  'bpmn:Property',
  'bpmn:CategoryValue',
];

function needsId(element: any): boolean {
  return ID_BEARING_TYPES.some((type) => element?.$instanceOf?.(type));
}

/** bpmn-js's semantic id prefixes (`bpmn:UserTask` → `Activity_`), reimplemented. */
function idPrefixFor(element: any): string {
  if (element?.$instanceOf?.('bpmn:Activity')) return 'Activity_';
  if (element?.$instanceOf?.('bpmn:Event')) return 'Event_';
  if (element?.$instanceOf?.('bpmn:Gateway')) return 'Gateway_';
  if (element?.$instanceOf?.('bpmn:SequenceFlow') || element?.$instanceOf?.('bpmn:MessageFlow')) return 'Flow_';
  return prefixFor(String(element?.$type ?? ''));
}

/**
 * The app's glyph pipeline, handed to the canvas as an {@link IconResolver}.
 *
 * The canvas asks by KEY: a marker name (`'loop'`, `'subprocess'`) for the
 * bottom-centre activity markers, or a BPMN type's local name (`'UserTask'`) for
 * the top-left type icon — plus, for the type icon, the element's business object,
 * which is where the schema-driven answer lives. The order mirrors
 * `draw/Renderer.drawShape`: a template's own `icon` wins, then the extension
 * type's `iconClass`, then the plain BPMN override.
 */
function resolveIcon(iconKey: string, businessObject?: any): IconDef | undefined {
  const marker = MARKER_ICONS[iconKey];
  if (marker) return { cssClass: marker };

  if (businessObject) {
    const element = StudyflowElement.fromBusinessObject(businessObject);
    const templateIcon = getRawAttribute(element.extension ?? businessObject, 'icon');
    const extEntry = element.extensionType ? getCatalog().getType(element.extensionType) : undefined;
    const cssClass = templateIcon || extEntry?.iconClass || BPMN_ICON_OVERRIDES[`bpmn:${iconKey}`];
    if (typeof cssClass === 'string' && cssClass) return { cssClass };
  }

  const inline = SVG_ICON_PATHS[iconKey];
  return inline ? inline : undefined;
}

/** Mount the canvas into `container` and assemble the facade over it. */
export function createCanvasBackend(options: CanvasBackendOptions): PortHandle {
  const canvas = new Canvas({
    container: options.container,
    onWarning: (warning: unknown) => console.warn('Canvas import warning:', warning),
    iconResolver: resolveIcon,
  });

  const moddle = new BpmnModdle(options.extensionSchemas) as any;

  // Before the first import there is no writeback (and so no scene-wide generator);
  // a standalone one covers the palette minting a business object on a blank editor.
  const preImportIds = new IdGenerator();
  const ids = (): IdGenerator => canvas.getWriteback()?.ids ?? preImportIds;

  // `buildBusinessObject` probes `moddle.ids` directly (bpmn-js hangs it off the
  // moddle instance in `BaseModeler`), so mirror that rather than fork the probe.
  moddle.ids = {
    nextPrefixed: (prefix: string, element?: ModelElement) => ids().nextPrefixed(prefix, element),
    assigned: (id: string) => ids().assigned(id),
    claim: (id: string) => ids().claim(id),
  };

  const model: EditorModel = {
    moddle: () => moddle,
    create: (type, properties) => moddle.create(type, properties),
    createBusinessObject: (type, properties) => {
      const element = moddle.create(type, properties);
      if (element.id) ids().claim(element.id);
      else if (needsId(element)) element.id = ids().nextPrefixed(idPrefixFor(element), element);
      return element;
    },
    fromXML: (xml) => moddle.fromXML(xml),
    toXML: (definitions, opts) => moddle.toXML(definitions, opts),
    ids: {
      nextPrefixed: (prefix, element) => ids().nextPrefixed(prefix, element),
      assigned: (id) => ids().assigned(id),
    },
  };

  const bus = canvas.getEventBus();

  // Late-bound: the history serializes through the port, and the port takes the
  // history as a dependency. One holder breaks the knot.
  const mounted: { port?: EditorPort } = {};

  const history = createSnapshotHistory({
    serialize: async () => (await mounted.port!.saveXML({ format: true })).xml,
    restore: async (xml) => {
      // An undo restores the DOCUMENT, not the session: what was selected and where
      // the user was looking survive it, exactly as they do on a command stack.
      // (A snapshot restore re-imports, and an import legitimately clears both.)
      const selectedIds = canvas.getSelection().get().map((element: any) => element.id);
      const viewbox = canvas.getViewport().getViewbox();
      const { rootElement } = await model.fromXML(xml);
      canvas.importDefinitions(rootElement as any);
      canvas.getViewport().setViewbox(viewbox);
      lastSceneRevision = canvas.getScene()?.revision ?? 0;
      // The same pair `EditorPort.importXML` fires, minus the history reset that
      // would throw away the very stack this is walking. Both go out BEFORE the
      // reselect: `root.set` means "the document was replaced, fall back to the
      // root", so anything listening (the inspector) resets on it — restoring the
      // selection afterwards is what makes the undo land on the element the user
      // was editing rather than on the diagram root.
      bus.fire('import.done', { error: null, warnings: [] });
      bus.fire('root.set', { element: mounted.port!.elements.root() });
      const restored = canvas.getScene();
      const reselect = selectedIds
        .map((id: string) => restored?.elementsById.get(id))
        .filter((element: any) => element && (element.kind === 'node' || element.kind === 'edge'));
      canvas.getSelection().select(reselect.length > 0 ? (reselect as any) : null);
    },
    onChanged: () => bus.fire('commandStack.changed', {}),
  });

  /**
   * Direct canvas gestures (drag, create, delete, inline rename) never pass through
   * `mutate.*`, so the history also watches the scene's own mutation counter: every
   * committing writeback call bumps `Scene.revision` and fires a change event. The
   * counter, not the event, is the guard — a batch fires one event per element.
   */
  let lastSceneRevision = 0;
  const onSceneChanged = (): void => {
    const revision = canvas.getScene()?.revision ?? 0;
    if (revision === lastSceneRevision) return;
    lastSceneRevision = revision;
    history.record('scene');
  };
  bus.on('element.changed', onSceneChanged);
  bus.on('elements.changed', onSceneChanged);
  bus.on('elements.removed', onSceneChanged);

  /**
   * The `elementFactory` half of the template pipeline (`templates/factory.ts` is
   * written against diagram-js's). A template shape is DETACHED — a type, a
   * footprint, and a business object the caller then decorates — which is exactly a
   * canvas {@link ShapeDescriptor}, so the shim mints the BO and lets the canvas's
   * own create gesture place it. Sizes come from the canvas's per-category defaults,
   * the same numbers a palette drop of that type would get.
   */
  const elementFactory = {
    create: (kind: 'shape' | 'connection', attrs: Record<string, any>) => {
      const businessObject = model.createBusinessObject(attrs.type, {});
      if (kind === 'connection') {
        return { ...attrs, id: (businessObject as any).id, businessObject };
      }
      const size = defaultSizeFor(attrs.type, attrs.isExpanded);
      return {
        ...attrs,
        id: (businessObject as any).id,
        businessObject,
        width: attrs.width ?? size.width,
        height: attrs.height ?? size.height,
      };
    },
  };

  const templatesService = new Templates(elementFactory, moddle, {
    fire: () => undefined,
  });
  templatesService.set(getCatalog().allTemplates());

  /**
   * A template whose root shape is still waiting to be dropped. `createElement`
   * builds the root and stashes the nested flow on it (`Templates.createElement`);
   * the flow can only be materialized once the canvas has actually placed that root,
   * which is whenever the scene next changes — hence the handoff through a slot
   * rather than a return value.
   */
  let pendingTemplate: { businessObject: any; flowElements: any[] } | undefined;

  const modelingShim = {
    createShape: (shape: any, bounds: any, parent: any, hints: any) =>
      port.mutate.createShape(shape, bounds, parent, hints),
    createConnection: (source: any, target: any, connection: any, parent: any, hints: any) =>
      port.mutate.createConnection(source, target, connection, parent, hints),
    resizeShape: (shape: any, bounds: any) => port.mutate.resizeShape(shape, bounds),
  };

  const materializePending = (): void => {
    const pending = pendingTemplate;
    if (!pending) return;
    const scene = canvas.getScene();
    if (!scene) return;
    let placed: any;
    for (const element of scene.elementsById.values()) {
      if ((element as any).businessObject === pending.businessObject) {
        placed = element;
        break;
      }
    }
    if (!placed) return;
    // Clear FIRST: materializing creates shapes, which re-enters this watcher.
    pendingTemplate = undefined;
    placed[TEMPLATE_FLOW_ELEMENTS] = pending.flowElements;
    materializeTemplateFlow({
      modeling: modelingShim,
      templatesService,
      shape: placed,
      hintKey: '__studyflowCreatingTemplateFlow',
    });
    canvas.getSelection().select(placed);
  };
  bus.on('elements.changed', materializePending);

  const port = createCanvasEditorPort(canvas, {
    model,
    history,
    // The history fires `commandStack.changed` itself, once per recorded mutation.
    emitCommandStackChanged: false,
    popup: { open: (providerId, position, opts) => openPopupMenu(providerId, position, opts) },
    templates: {
      getAll: () => templatesService.getAll(),
      // The same `templates/factory.ts` the bpmn backend runs, over the shim
      // factory above — so a template's pinned attributes, loop characteristics,
      // event definitions and extension all land identically on either backend.
      // Its nested flow (a pool's or sub-process's contents) is stashed on the
      // returned root and materialized once the canvas places it.
      createElement: (template: any) => {
        const shape = templatesService.createElement(template);
        const flowElements = shape[TEMPLATE_FLOW_ELEMENTS];
        pendingTemplate = flowElements?.length
          ? { businessObject: shape.businessObject, flowElements }
          : undefined;
        delete shape[TEMPLATE_FLOW_ELEMENTS];
        return shape;
      },
    },
    simulation: {
      // Token simulation is a bpmn-js command-stack feature (`simulation/module.ts`);
      // it has no canvas counterpart yet, so it reports itself off rather than lying.
      toggle: () => console.warn('Token simulation is not available on the canvas backend yet.'),
      isActive: () => false,
    },
  }) as EditorPort;
  mounted.port = port;

  /**
   * Undo/redo from the keyboard. bpmn-js gets this from its `keyboard` module bound
   * to the diagram container; the canvas owns no shortcut vocabulary beyond
   * Delete/Backspace, so the *history* owner binds the history keys — scoped to the
   * canvas container (the SVG root is focusable and the event bubbles), never the
   * document, so typing in the inspector is untouched.
   */
  const onHistoryKey = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;

    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) history.undo();
    else if ((key === 'z' && event.shiftKey) || key === 'y') history.redo();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  options.container.addEventListener('keydown', onHistoryKey);

  return {
    backend: 'canvas',
    editor: port,
    destroy: () => {
      options.container.removeEventListener('keydown', onHistoryKey);
      bus.off('element.changed', onSceneChanged);
      bus.off('elements.changed', onSceneChanged);
      bus.off('elements.removed', onSceneChanged);
      bus.off('elements.changed', materializePending);
      history.dispose();
      canvas.getSvg().remove();
    },
  };
}
