/**
 * `mountEditor`: put a canvas on a study in a container and hand back the {@link Editor}.
 * Everything schema-, document- or app-shaped is assembled here and injected: the icon
 * resolver, templates and the simulator.
 */

import { Canvas, renderSvg } from '@canvas/index.ts';
import type { CanvasOptions, IconDef, Insets, Study } from '@canvas/index.ts';
import { getCatalog } from '@core/notation';
import { StudyflowElement } from '@core/element';
import { BPMN_ICON_OVERRIDES, MARKER_ICONS } from '@modeler/draw/icons';
import { EventBus } from '@modeler/editor/bus';
import TokenSimulator from '@modeler/simulation/TokenSimulator';
import { getSettings, subscribeSettings } from '@modeler/settings/store';
import type { Editor, EditorModel, EditorSimulation, EditorTemplates, Moddle } from '@modeler/editor/port';

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
  // Anything else is the canvas's: its own glyph, when it has one.
  return undefined;
}

/** Room left between the diagram and the app's chrome, in CSS pixels. */
const CHROME_GAP = 8;

/**
 * How far the app's floating chrome reaches into the canvas from each edge, measured now: every element marked
 * `data-covers="<edge>"` (the palette, the nav bar, the inspector), while it shows.
 */
function coveredEdges(container: HTMLElement): Insets {
  const view = container.getBoundingClientRect();
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const element of container.ownerDocument.querySelectorAll<HTMLElement>('[data-covers]')) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const reach = { top: box.bottom - view.top, right: view.right - box.left, bottom: view.bottom - box.top, left: box.right - view.left };
    const edge = element.dataset.covers as keyof typeof reach;
    if (edge in reach) insets[edge] = Math.max(insets[edge], reach[edge] + CHROME_GAP);
  }
  return insets;
}

export function mountEditor(options: MountEditorOptions): Editor {
  const { study } = options;
  // How the app draws a study, on the canvas and in a picture of it.
  const drawing: CanvasOptions = { iconResolver: resolveIcon };
  const canvas = new Canvas(options.container, study, { ...drawing, insets: () => coveredEdges(options.container) });
  const model: EditorModel = {
    moddle: () => options.moddle,
    packages: () => options.extensionSchemas,
  };

  // The app's bus: the view's news and the study's, forwarded in the topics the app's modules hear.
  const bus = new EventBus();
  const stopHearingCanvas = [
    canvas.on('select', (ids) => bus.fire('SelectionChanged', { newSelection: ids })),
    canvas.on('scope', (scope) => bus.fire('RootSet', { scope })),
    canvas.on('appendMenu', (ids) => void bus.send({ type: 'OpenAppendMenu', ids }).catch(() => undefined)),
  ];

  const saveXML = async (): Promise<{ xml: string }> => ({ xml: await study.toXml() });

  const importXML = async (xml: string): Promise<{ warnings: unknown[] }> => {
    await study.load(xml);
    return { warnings: [] };
  };

  // What the app hears of the study, after the canvas has drawn it (and said `RootSet`): an edit, by id; an edit,
  // an undo or a redo moves the history; a load, an undo or a redo puts another document in place, which
  // everything re-reads.
  const stopHearing = study.on('change', ({ cause, added, changed, removed }) => {
    if (cause === 'edit') bus.fire('ElementsChanged', { added, changed, removed });
    else bus.fire('ImportDone', { error: null, warnings: [] });
    if (cause !== 'load') bus.fire('HistoryChanged', {});
  });

  const templates: EditorTemplates = { getAll: () => getCatalog().allTemplates() };

  const simulator = new TokenSimulator({ events: bus, study, canvas });
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
    toSvg: () => renderSvg(study, { ...drawing, scope: canvas.scope }),
    getDefinitions: () => study.definitions,
    study,
    canvas,
    events: bus,
    model,
    templates,
    simulation,
    destroy: () => {
      simulator.dispose();
      unsubscribeSettings();
      stopHearing();
      for (const stop of stopHearingCanvas) stop();
      canvas.destroy();
      bus.clear();
    },
  };
}
