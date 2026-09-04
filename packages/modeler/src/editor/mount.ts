/**
 * `mountEditor`: put a canvas in a container and hand back the {@link Editor}.
 * Everything schema-, document- or app-shaped is assembled here and injected: the
 * moddle, the snapshot history, the icon resolver, templates and the simulator.
 */

import { BpmnModdle } from 'bpmn-moddle';
import { Canvas, IdGenerator, defaultSizeFor, isRootElement } from '@canvas/index.ts';
import type { IconDef, SceneElement } from '@canvas/index.ts';
import { idPrefixFor, needsId } from '@canvas/model/ids.ts';
import { SVG_ICON_PATHS } from '@canvas/render/icons.ts';
import { resolvePlaceholders } from '@core/document';
import { getCatalog } from '@core/notation';
import { StudyflowElement, getRawAttribute } from '@core/element';
import { BPMN_ICON_OVERRIDES, MARKER_ICONS } from '@modeler/draw/icons';
import { lookupIcon, onIconResolved, primeIconCache } from '@modeler/draw/iconCache';
import { createSnapshotHistory } from '@modeler/editor/history';
import TokenSimulator from '@modeler/simulation/TokenSimulator';
import { getSettings, subscribeSettings } from '@modeler/settings/store';
import { TEMPLATE_FLOW_ELEMENTS, createTemplateElement, materializeTemplateFlow } from '@modeler/templates/factory';
import type { Editor, EditorModel, EditorSimulation, EditorTemplates, ModelElement } from '@modeler/editor/port';

export type MountEditorOptions = {
  container: HTMLElement;
  extensionSchemas: Record<string, any>;
};

const ICON_REDRAW_DEBOUNCE_MS = 50;

function iconFor(cssClass: string): IconDef {
  return lookupIcon(cssClass) ?? { cssClass };
}

/**
 * The app's glyph pipeline as the canvas's icon resolver: a marker name or a BPMN
 * local name in, a resolved glyph out. `null` means "this type has no glyph".
 */
function resolveIcon(iconKey: string, businessObject?: any): IconDef | null | undefined {
  const marker = MARKER_ICONS[iconKey];
  if (marker) return iconFor(marker);
  if (iconKey.startsWith('iconify ') || iconKey.startsWith('i-')) return iconFor(iconKey);
  if (businessObject) {
    const element = StudyflowElement.fromBusinessObject(businessObject);
    const templateIcon = getRawAttribute(element.extension ?? businessObject, 'icon');
    const extEntry = element.extensionType ? getCatalog().getType(element.extensionType) : undefined;
    const bpmnFallback = iconKey === 'DataObjectReference' ? undefined : BPMN_ICON_OVERRIDES[`bpmn:${iconKey}`];
    const cssClass = templateIcon || extEntry?.iconClass || bpmnFallback;
    if (typeof cssClass === 'string' && cssClass) return iconFor(cssClass);
  }
  return SVG_ICON_PATHS[iconKey] ?? null;
}

export function mountEditor(options: MountEditorOptions): Editor {
  const canvas: Canvas = new Canvas({
    container: options.container,
    onWarning: (warning: unknown) => console.warn('Canvas import warning:', warning),
    iconResolver: resolveIcon,
    // `{count}` in a label draws its run-state value; the model, the file and the inspector keep the raw text.
    labelText: (bo, name) => resolvePlaceholders(name, canvas.getDefinitions() as any, bo?.id ?? ''),
  });
  const moddle = new BpmnModdle(options.extensionSchemas) as any;

  // Before the first import there is no scene-wide generator; a standalone one covers the palette.
  const preImportIds = new IdGenerator();
  const ids = (): IdGenerator => canvas.getMutator()?.ids ?? preImportIds;
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

  const saveXML = async (opts?: { format?: boolean }): Promise<{ xml: string }> => {
    const definitions = canvas.getDefinitions();
    if (!definitions) throw new Error('@behaverse/studyflow-modeler: nothing to serialize');
    canvas.syncDi();
    return model.toXML(definitions, opts);
  };

  let lastSceneRevision = 0;

  const history = createSnapshotHistory({
    serialize: async () => (await saveXML({ format: true })).xml,
    restore: async (xml) => {
      // An undo restores the document, not the session: selection, scope and viewbox survive.
      const selectedIds = canvas.getSelection().get().map((element) => element.id);
      const scopeId = canvas.getScope()?.id;
      const viewbox = canvas.getViewport().getViewbox();
      const { rootElement } = await model.fromXML(xml);
      canvas.importDefinitions(rootElement);
      const scope = scopeId ? canvas.get(scopeId) : undefined;
      if (scope && !isRootElement(scope) && scope.kind === 'node') canvas.enterScope(scope);
      canvas.getViewport().setViewbox(viewbox);
      lastSceneRevision = canvas.getScene()?.revision ?? 0;
      bus.fire('ImportDone', { error: null, warnings: [] });
      bus.fire('RootSet', { element: canvas.getRoot() });
      const reselect = selectedIds
        .map((id) => canvas.get(id))
        .filter((element): element is SceneElement => !!element && !isRootElement(element));
      canvas.getSelection().select(reselect.length > 0 ? reselect : null);
    },
    onChanged: () => bus.fire('CommandStackChanged', {}),
  });

  const importXML = async (xml: string): Promise<{ warnings: unknown[] }> => {
    const { rootElement } = await model.fromXML(xml);
    canvas.importDefinitions(rootElement);
    lastSceneRevision = canvas.getScene()?.revision ?? 0;
    history.reset();
    bus.fire('ImportDone', { error: null, warnings: [] });
    bus.fire('RootSet', { element: canvas.getRoot() });
    return { warnings: [] };
  };

  // Every committing edit bumps the scene revision; that is the history's commit point.
  const onSceneChanged = (): void => {
    const revision = canvas.getScene()?.revision ?? 0;
    if (revision === lastSceneRevision) return;
    lastSceneRevision = revision;
    history.record();
  };
  bus.on('ElementChanged', onSceneChanged);
  bus.on('ElementsChanged', onSceneChanged);
  bus.on('ElementsRemoved', onSceneChanged);

  // Templates: a detached shape per template; a nested flow is materialized once the root lands.
  const elementFactory = {
    create: (kind: 'shape' | 'connection', attrs: Record<string, any>) => {
      const businessObject = model.createBusinessObject(attrs.type, {});
      if (kind === 'connection') return { ...attrs, id: businessObject.id, businessObject };
      const size = defaultSizeFor(attrs.type, attrs.isExpanded);
      return { ...attrs, id: businessObject.id, businessObject, width: attrs.width ?? size.width, height: attrs.height ?? size.height };
    },
  };

  let pendingTemplate: { businessObject: any; flowElements: any[] } | undefined;
  const modelingShim = {
    createShape: (shape: any, bounds: any) => canvas.createElement(shape, { x: bounds.x, y: bounds.y }),
    createConnection: (source: any, target: any) => {
      const from = canvas.resolveElement(source);
      const to = canvas.resolveElement(target);
      if (!from || from.kind === 'label' || !to || to.kind !== 'node') return undefined;
      return canvas.connectElements(from, to);
    },
    resizeShape: (shape: any, bounds: any) => {
      const node = canvas.resolveElement(shape);
      if (node?.kind === 'node') canvas.resizeShape(node, bounds);
    },
  };
  const materializePending = (): void => {
    const pending = pendingTemplate;
    if (!pending) return;
    const placed = canvas.all().find((element) => element.kind !== 'label' && element.businessObject === pending.businessObject) as any;
    if (!placed) return;
    pendingTemplate = undefined;
    placed[TEMPLATE_FLOW_ELEMENTS] = pending.flowElements;
    materializeTemplateFlow({ modeling: modelingShim, elementFactory, moddle, shape: placed, hintKey: '__studyflowCreatingTemplateFlow' });
    canvas.getSelection().select(placed);
  };
  bus.on('ElementChanged', materializePending);
  bus.on('ElementsChanged', materializePending);

  const templates: EditorTemplates = {
    getAll: () => getCatalog().allTemplates(),
    createElement: (template: any) => {
      const shape = createTemplateElement(template, elementFactory, moddle);
      const flowElements = shape[TEMPLATE_FLOW_ELEMENTS];
      pendingTemplate = flowElements?.length ? { businessObject: shape.businessObject, flowElements } : undefined;
      delete shape[TEMPLATE_FLOW_ELEMENTS];
      return shape;
    },
  };

  const simulator = new TokenSimulator({ events: bus, canvas });
  const simulation: EditorSimulation = { toggle: () => simulator.toggle(), isActive: () => simulator.isActive() };

  const applySettings = (): void => canvas.setSnapToGrid(getSettings().snapToGrid);
  applySettings();
  const unsubscribeSettings = subscribeSettings(applySettings);

  // Undo/redo from the keyboard, scoped to the canvas container.
  const onHistoryKey = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) history.undo();
    else if (key === 'z' && event.shiftKey) history.redo();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  options.container.addEventListener('keydown', onHistoryKey);

  // Glyphs arrive asynchronously; one coalesced re-draw per burst.
  primeIconCache();
  let iconRedraw: ReturnType<typeof setTimeout> | undefined;
  const stopIconWatch = onIconResolved(() => {
    clearTimeout(iconRedraw);
    iconRedraw = setTimeout(() => {
      const nodes = canvas.all().filter((element) => element.kind === 'node');
      if (nodes.length > 0) canvas.redrawElements(nodes);
    }, ICON_REDRAW_DEBOUNCE_MS);
  });

  return {
    revision: () => history.revision(),
    undo: () => history.undo(),
    redo: () => history.redo(),
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    importXML,
    saveXML,
    getDefinitions: () => canvas.getDefinitions(),
    canvas,
    selection: canvas.getSelection(),
    events: bus,
    model,
    templates,
    simulation,
    destroy: () => {
      simulator.dispose();
      unsubscribeSettings();
      options.container.removeEventListener('keydown', onHistoryKey);
      bus.off('ElementChanged', onSceneChanged);
      bus.off('ElementsChanged', onSceneChanged);
      bus.off('ElementsRemoved', onSceneChanged);
      bus.off('ElementChanged', materializePending);
      bus.off('ElementsChanged', materializePending);
      history.dispose();
      stopIconWatch();
      clearTimeout(iconRedraw);
      canvas.destroy();
    },
  };
}
