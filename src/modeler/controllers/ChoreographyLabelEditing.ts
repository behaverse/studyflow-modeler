import LabelEditingProvider from 'bpmn-js/lib/features/label-editing/LabelEditingProvider';
import { getAttribute, setAttribute } from '@/core/extensions';
import { choreographyBandHeight, isChoreographyTask } from '@/modeler/models/render/choreography';

/** Runs before bpmn-js's own dblclick handler so the band is known on activate. */
const BAND_STAMP_PRIORITY = 2000;

type Band = 'top' | 'bottom' | 'name';

/** The transient field we stamp onto the element from the double-click position. */
type ChoreoShape = { _choreoBand?: Band; x: number; y: number; height: number };

const FONT_FAMILY = '"IBM Plex Sans", Helvetica, sans-serif';

/**
 * Extends bpmn-js label editing so choreography tasks are editable in place.
 * Double-clicking a participant band edits `topParticipant` /
 * `bottomParticipant`; double-clicking the middle edits the task name. All
 * three regions need custom bounds: `bpmn:ChoreographyTask` is not a
 * `bpmn:Task`, so the stock provider would otherwise create a zero-size
 * editing box. Bound as `labelEditingProvider`, this replaces the stock
 * provider and delegates every non-choreography case to it via `super`.
 */
export default class ChoreographyLabelEditing extends LabelEditingProvider {
  static $inject = [
    'eventBus', 'bpmnFactory', 'canvas', 'directEditing',
    'modeling', 'resizeHandles', 'textRenderer',
  ];

  private choreoCanvas: any;
  private choreoModeling: any;
  /** Band of the in-flight editing session; consumed by `update`. */
  private activeBand: Band | undefined;

  constructor(
    eventBus: any, bpmnFactory: any, canvas: any, directEditing: any,
    modeling: any, resizeHandles: any, textRenderer: any,
  ) {
    super(eventBus, bpmnFactory, canvas, directEditing, modeling, resizeHandles, textRenderer);
    this.choreoCanvas = canvas;
    this.choreoModeling = modeling;

    eventBus.on('element.dblclick', BAND_STAMP_PRIORITY, (event: any) => {
      const element = event.element as ChoreoShape | undefined;
      if (!element) return;
      element._choreoBand = isChoreographyTask(element)
        ? this.bandAt(element, event.originalEvent)
        : undefined;
    });
  }

  /** Map a double-click position to a band using the canvas viewbox transform. */
  private bandAt(element: ChoreoShape, originalEvent: MouseEvent | undefined): Band {
    if (!originalEvent) return 'name';
    const container = this.choreoCanvas.getContainer();
    const box = container.getBoundingClientRect();
    const viewbox = this.choreoCanvas.viewbox();
    const localY = viewbox.y + (originalEvent.clientY - box.top) / viewbox.scale;
    const rel = localY - element.y;
    const bandHeight = choreographyBandHeight(element);
    if (rel <= bandHeight) return 'top';
    if (rel >= element.height - bandHeight) return 'bottom';
    return 'name';
  }

  private static attrFor(band: Band): 'topParticipant' | 'bottomParticipant' | null {
    if (band === 'top') return 'topParticipant';
    if (band === 'bottom') return 'bottomParticipant';
    return null;
  }

  /** Screen-space bounds of one editing region of a choreography task. */
  private regionBounds(element: any, band: Band) {
    const canvas = this.choreoCanvas;
    const bbox = canvas.getAbsoluteBBox(element);
    const zoom = canvas.zoom();
    const bandHeight = choreographyBandHeight(element) * zoom;

    const region = band === 'name'
      ? { y: bbox.y + bandHeight, height: bbox.height - 2 * bandHeight }
      : { y: band === 'top' ? bbox.y : bbox.y + bbox.height - bandHeight, height: bandHeight };

    return {
      bounds: { x: bbox.x, y: region.y, width: bbox.width, height: region.height },
      style: {
        fontFamily: FONT_FAMILY,
        fontWeight: band === 'name' ? '600' : '400',
        fontSize: ((band === 'name' ? 12 : 11) * zoom) + 'px',
        lineHeight: 1.2,
      },
    };
  }

  activate(element: any): any {
    if (!isChoreographyTask(element)) {
      this.activeBand = undefined;
      return super.activate(element);
    }

    const band: Band = element._choreoBand ?? 'name';
    delete element._choreoBand;
    this.activeBand = band;

    const attr = ChoreographyLabelEditing.attrFor(band);
    const text = attr ? (getAttribute(element, attr) ?? '') : (element.businessObject?.name ?? '');
    const { bounds, style } = this.regionBounds(element, band);
    return { text, bounds, style, options: { centerVertically: true } };
  }

  update(element: any, newLabel: any, activeContextText: any, bounds: any): void {
    const attr = isChoreographyTask(element) && this.activeBand
      ? ChoreographyLabelEditing.attrFor(this.activeBand)
      : null;
    this.activeBand = undefined;

    if (attr) {
      const value = typeof newLabel === 'string' ? newLabel.trim() : '';
      setAttribute(element, attr, value, this.choreoModeling);
      return;
    }
    // The name band (and every non-choreography element) keeps the stock
    // behaviour: `modeling.updateLabel` handles bpmn:FlowElement names.
    super.update(element, newLabel, activeContextText, bounds);
  }
}
