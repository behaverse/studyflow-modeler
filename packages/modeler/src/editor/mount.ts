/**
 * `mountEditor`: put a canvas on a study in a container and hand back the {@link Editor}.
 * Everything schema-, document- or app-shaped is assembled here and injected: the
 * snapshot history, the icon resolver, templates and the simulator.
 */

import { Canvas, SVG_ICON_PATHS, idPrefixFor, isRootElement, needsId } from '@canvas/index.ts';
import type { IconDef, SceneElement, Study } from '@canvas/index.ts';
import { resolvePlaceholders } from '@core/document';
import { getCatalog } from '@core/notation';
import { StudyflowElement } from '@core/element';
import { BPMN_ICON_OVERRIDES, MARKER_ICONS } from '@modeler/draw/icons';
import { createSnapshotHistory } from '@modeler/editor/history';
import TokenSimulator from '@modeler/simulation/TokenSimulator';
import { getSettings, subscribeSettings } from '@modeler/settings/store';
import { createTemplateElement, materializeTemplateFlow, type TemplateFlow } from '@modeler/templates/factory';
import type { Editor, EditorModel, EditorSimulation, EditorTemplates, ModelElement, Moddle } from '@modeler/editor/port';

export type MountEditorOptions = {
  container: HTMLElement;
  /** The document the editor opens on, read by `moddle`. */
  study: Study;
  /** A moddle over `extensionSchemas`, the schemas enabled in Settings. */
  moddle: Moddle;
  extensionSchemas: Record<string, any>;
};

/**
 * A `data:` image draws as itself (a URL to fetch does not: nothing fetches an icon); anything
 * else is a class the app's stylesheet paints, whose glyph the canvas inlines from the CSS.
 */
const iconFor = (icon: string): IconDef => (/^data:image\//i.test(icon) ? { href: icon } : { cssClass: icon });

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
    const templateIcon = (element.extension ?? element.businessObject).get?.('studyflow:icon');
    const extEntry = element.extensionType ? getCatalog().getType(element.extensionType) : undefined;
    const bpmnFallback = iconKey === 'DataObjectReference' ? undefined : BPMN_ICON_OVERRIDES[`bpmn:${iconKey}`];
    const icon = templateIcon || extEntry?.iconClass || bpmnFallback;
    if (typeof icon === 'string' && icon) return iconFor(icon);
  }
  return SVG_ICON_PATHS[iconKey] ?? null;
}

export function mountEditor(options: MountEditorOptions): Editor {
  const { study } = options;
  const canvas = new Canvas(options.container, study, {
    iconResolver: resolveIcon,
    // `{count}` in a label draws its run-state value; the model, the file and the inspector keep the raw text.
    labelText: (bo, name) => resolvePlaceholders(name, study.definitions as any, bo?.id ?? ''),
  });
  const moddle = options.moddle as any;

  // The palette mints ids through the moddle, from those the study holds.
  const ids = () => canvas.getIds();
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
    ids: {
      nextPrefixed: (prefix, element) => ids().nextPrefixed(prefix, element),
      assigned: (id) => ids().assigned(id),
    },
  };

  const bus = canvas.getEventBus();

  const saveXML = async (): Promise<{ xml: string }> => ({ xml: await study.toXml() });

  const history = createSnapshotHistory({
    serialize: () => study.toXml(),
    restore: async (xml) => {
      // An undo restores the document, not the session: selection, scope and viewbox survive.
      const selectedIds = canvas.getSelection().get().map((element) => element.id);
      const scopeId = canvas.getScope()?.id;
      const viewbox = canvas.getViewport().getViewbox();
      await study.load(xml);
      const scope = scopeId ? canvas.get(scopeId) : undefined;
      if (scope && !isRootElement(scope) && scope.kind === 'node') canvas.enterScope(scope);
      canvas.getViewport().setViewbox(viewbox);
      bus.fire('ImportDone', { error: null, warnings: [] });
      bus.fire('RootSet', { element: canvas.getRoot() });
      const reselect = selectedIds
        .map((id) => canvas.get(id))
        .filter((element): element is SceneElement => !!element && !isRootElement(element));
      canvas.getSelection().select(reselect.length > 0 ? reselect : null);
    },
    onChanged: () => bus.fire('HistoryChanged', {}),
  });

  const importXML = async (xml: string): Promise<{ warnings: unknown[] }> => {
    await study.load(xml);
    history.reset();
    bus.fire('ImportDone', { error: null, warnings: [] });
    bus.fire('RootSet', { element: canvas.getRoot() });
    return { warnings: [] };
  };

  // The canvas fires `ElementsChanged` once per committed edit; that is the history's commit point.
  const onSceneChanged = (): void => history.record();
  bus.on('ElementsChanged', onSceneChanged);

  // Templates: the palette drags a template's shape; the flow it holds is laid out inside once it lands.
  let pendingFlow: { businessObject: ModelElement; flow: TemplateFlow } | undefined;
  const materializePending = (): void => {
    const pending = pendingFlow;
    const placed = pending && canvas.getScene()?.byBusinessObject.get(pending.businessObject);
    if (!pending || placed?.kind !== 'node') return;
    pendingFlow = undefined;
    canvas.batch(() => materializeTemplateFlow(canvas, placed, pending.flow));
    canvas.getSelection().select(placed);
  };
  bus.on('ElementsChanged', materializePending);

  const templates: EditorTemplates = {
    getAll: () => getCatalog().allTemplates(),
    createElement: (template) => {
      const { shape, flow } = createTemplateElement(model, template, study.definitions);
      pendingFlow = flow.nodes.length > 0 ? { businessObject: shape.businessObject, flow } : undefined;
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
    getDefinitions: () => study.definitions,
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
      bus.off('ElementsChanged', onSceneChanged);
      bus.off('ElementsChanged', materializePending);
      history.dispose();
      canvas.destroy();
    },
  };
}
