/**
 * `mountEditor`: put a canvas on a study in a container and hand back the {@link Editor}.
 * Everything schema-, document- or app-shaped is assembled here and injected: the icon
 * resolver and the simulator.
 */

import { Canvas, renderSvg } from '@canvas/index.ts';
import type { CanvasOptions, Insets, Study } from '@canvas/index.ts';
import { parseStudy } from '@core/document';
import type { Metamodel } from '@core/model/metamodel';
import { resolveIcon } from '@modeler/draw/icons';
import { EventBus } from '@modeler/editor/bus';
import TokenSimulator from '@modeler/simulation/TokenSimulator';
import { getSettings, subscribeSettings } from '@modeler/settings/store';
import type { Editor, EditorModel, EditorSimulation } from '@modeler/editor/port';

export type MountEditorOptions = {
  container: HTMLElement;
  /** The study the editor opens on, read by `metamodel`. */
  study: Study;
  /** The metamodel of the schemas enabled in Settings. */
  metamodel: Metamodel;
};

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
  // The app's drawing options, for the canvas and for a picture of it.
  const drawing: CanvasOptions = { iconResolver: resolveIcon };
  const canvas = new Canvas(options.container, study, { ...drawing, insets: () => coveredEdges(options.container) });
  const model: EditorModel = { metamodel: () => options.metamodel };

  // The app's bus. The canvas's and the study's events are forwarded onto it under the topics the app's modules listen for.
  const bus = new EventBus();
  const stopHearingCanvas = [
    canvas.on('select', (ids) => bus.fire('SelectionChanged', { newSelection: ids })),
    canvas.on('scope', (scope) => bus.fire('RootSet', { scope })),
    canvas.on('appendMenu', (ids) => void bus.send({ type: 'OpenAppendMenu', ids }).catch(() => undefined)),
    canvas.on('addMenu', (at) => void bus.send({ type: 'OpenAddMenu', at }).catch(() => undefined)),
    canvas.on('insertMenu', ({ edge, at }) => void bus.send({ type: 'OpenInsertMenu', edge, at }).catch(() => undefined)),
  ];

  const saveXML = async (): Promise<{ xml: string }> => ({ xml: await study.toXml() });


  // Forwards the study's changes, after the canvas has drawn them (and fired `RootSet`). An edit fires
  // `ElementsChanged` with the ids it touched. A load, an undo or a redo replaces the document, so it fires
  // `ImportDone` and every listener re-reads. Everything but a load fires `HistoryChanged`.
  const stopHearing = study.on('change', ({ cause, added, changed, removed }) => {
    if (cause === 'edit') bus.fire('ElementsChanged', { added, changed, removed });
    else bus.fire('ImportDone', { error: null, warnings: [] });
    if (cause !== 'load') bus.fire('HistoryChanged', {});
  });

  const simulator = new TokenSimulator({ events: bus, study, canvas });
  const simulation: EditorSimulation = {
    toggle: () => simulator.toggle(),
    isActive: () => simulator.isActive(),
    pause: () => simulator.pause(),
    resume: () => simulator.resume(),
    step: () => simulator.step(),
    isPaused: () => simulator.isPaused(),
  };

  const applySettings = (): void => canvas.setSnapToGrid(getSettings().snapToGrid);
  applySettings();
  const unsubscribeSettings = subscribeSettings(applySettings);

  return {
    revision: () => study.revision,
    undo: () => study.undo(),
    redo: () => study.redo(),
    canUndo: () => study.canUndo,
    canRedo: () => study.canRedo,
    open: async (text, onWarning, pastedImages) => study.load(await parseStudy(text, options.metamodel, { onWarning }), pastedImages),
    saveXML,
    toSvg: (svg) => renderSvg(study, { ...drawing, scope: canvas.scope, ...svg }),
    study,
    canvas,
    events: bus,
    model,
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
