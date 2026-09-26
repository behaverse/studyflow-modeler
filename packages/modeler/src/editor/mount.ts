/**
 * `mountEditor`: put a canvas on a study in a container and hand back the {@link Editor}.
 * Everything schema-, document- or app-shaped is assembled here and injected: the icon
 * resolver, templates and the simulator.
 */

import { Canvas, SVG_ICON_PATHS, idPrefixFor, needsId, renderSvg } from '@canvas/index.ts';
import type { CanvasOptions, IconDef, Study } from '@canvas/index.ts';
import { resolvePlaceholders } from '@core/document';
import { getCatalog } from '@core/notation';
import { StudyflowElement } from '@core/element';
import { BPMN_ICON_OVERRIDES, MARKER_ICONS } from '@modeler/draw/icons';
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
  // How the app draws a study, on the canvas and in a picture of it.
  const drawing: CanvasOptions = {
    iconResolver: resolveIcon,
    // `{count}` in a label draws its run-state value; the model, the file and the inspector keep the raw text.
    labelText: (bo, name) => resolvePlaceholders(name, study.definitions as any, bo?.id ?? ''),
  };
  const canvas = new Canvas(options.container, study, drawing);
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

  const importXML = async (xml: string): Promise<{ warnings: unknown[] }> => {
    await study.load(xml);
    return { warnings: [] };
  };

  // What the app hears of the study, after the canvas has drawn it (and said `RootSet`): an edit, an undo or
  // a redo moves the history; a load, an undo or a redo puts another document in place, which everything re-reads.
  const stopHearing = study.on('change', ({ cause }) => {
    if (cause !== 'edit') bus.fire('ImportDone', { error: null, warnings: [] });
    if (cause !== 'load') bus.fire('HistoryChanged', {});
  });

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

  return {
    revision: () => study.revision,
    undo: () => study.undo(),
    redo: () => study.redo(),
    canUndo: () => study.canUndo,
    canRedo: () => study.canRedo,
    importXML,
    saveXML,
    toSvg: () => renderSvg(study, { ...drawing, scope: canvas.getScope() }),
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
      stopHearing();
      bus.off('ElementsChanged', materializePending);
      canvas.destroy();
    },
  };
}
