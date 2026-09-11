/**
 * `mountEditor`: put a canvas in a container and hand back the {@link Editor}.
 * Everything schema-, document- or app-shaped is assembled here and injected: the
 * moddle, the snapshot history, the icon resolver, templates and the simulator.
 */

import { BpmnModdle } from 'bpmn-moddle';
import { Canvas, IdGenerator, SVG_ICON_PATHS, idPrefixFor, isRootElement, needsId } from '@canvas/index.ts';
import type { IconDef, SceneElement } from '@canvas/index.ts';
import { resolvePlaceholders } from '@core/document';
import { getCatalog } from '@core/notation';
import { StudyflowElement, getRawAttribute } from '@core/element';
import { BPMN_ICON_OVERRIDES, MARKER_ICONS } from '@modeler/draw/icons';
import { createSnapshotHistory } from '@modeler/editor/history';
import TokenSimulator from '@modeler/simulation/TokenSimulator';
import { getSettings, subscribeSettings } from '@modeler/settings/store';
import { createTemplateElement, materializeTemplateFlow } from '@modeler/templates/factory';
import type { TemplateFlowElement } from '@core/notation';
import type { Editor, EditorModel, EditorSimulation, EditorTemplates, ModelElement } from '@modeler/editor/port';

export type MountEditorOptions = {
  container: HTMLElement;
  extensionSchemas: Record<string, any>;
};

/** A class the app's stylesheet paints; the canvas inlines its glyph from the CSS. */
const iconFor = (cssClass: string): IconDef => ({ cssClass });

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
  // moddle rewrites the property descriptors it registers, so it gets a copy: `packages()` hands out the original.
  const moddle = new BpmnModdle(structuredClone(options.extensionSchemas)) as any;

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
    packages: () => options.extensionSchemas,
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

  // Templates: the palette drags a template's shape; the flow it holds is laid out inside once it lands.
  let pendingFlow: { businessObject: ModelElement; flowElements: TemplateFlowElement[] } | undefined;
  const materializePending = (): void => {
    const pending = pendingFlow;
    const placed = pending && canvas.getScene()?.byBusinessObject.get(pending.businessObject);
    if (!pending || placed?.kind !== 'node') return;
    pendingFlow = undefined;
    materializeTemplateFlow(canvas, model, placed, pending.flowElements);
    canvas.getSelection().select(placed);
  };
  bus.on('ElementChanged', materializePending);
  bus.on('ElementsChanged', materializePending);

  const templates: EditorTemplates = {
    getAll: () => getCatalog().allTemplates(),
    createElement: (template) => {
      const { shape, flowElements } = createTemplateElement(model, template);
      pendingFlow = flowElements.length > 0 ? { businessObject: shape.businessObject, flowElements } : undefined;
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
      canvas.destroy();
    },
  };
}
