import LabelEditingProvider from 'bpmn-js/lib/features/label-editing/LabelEditingProvider';
import { getAttribute, setAttribute } from '@/lib/core/extensions';
import { choreographyBandHeight, isChoreographyTask } from './render/choreography';

/** Runs before bpmn-js's own dblclick handler so the band is known on activate. */
const BAND_STAMP_PRIORITY = 2000;

type Band = 'top' | 'bottom' | 'name';

/** The transient field we stamp onto the element from the double-click position. */
type ChoreoShape = { _choreoBand?: Band; x: number; y: number; height: number };

/**
 * Extends bpmn-js label editing so the participant bands of a choreography task
 * are editable in place. Double-clicking a band edits `topParticipant` /
 * `bottomParticipant`; double-clicking the middle edits the task name (default
 * bpmn-js behaviour). Bound as `labelEditingProvider`, this replaces the stock
 * provider and delegates every non-choreography case to it via `super`.
 */
export default class ChoreographyLabelEditing extends LabelEditingProvider {
  static $inject = [
    'eventBus', 'bpmnFactory', 'canvas', 'directEditing',
    'modeling', 'resizeHandles', 'textRenderer',
  ];

  private choreoCanvas: any;
  private choreoModeling: any;

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

  /** Screen-space bounds of a participant band, for positioning the text box. */
  private bandBounds(element: any, band: 'top' | 'bottom') {
    const canvas = this.choreoCanvas;
    const bbox = canvas.getAbsoluteBBox(element);
    const zoom = canvas.zoom();
    const bandHeight = choreographyBandHeight(element) * zoom;
    const y = band === 'top' ? bbox.y : bbox.y + bbox.height - bandHeight;
    return {
      bounds: { x: bbox.x, y, width: bbox.width, height: bandHeight },
      style: {
        fontFamily: '"IBM Plex Sans", Helvetica, sans-serif',
        fontWeight: '400',
        fontSize: (11 * zoom) + 'px',
        lineHeight: 1.2,
      },
    };
  }

  activate(element: any): any {
    const band: Band | undefined = element?._choreoBand;
    const attr = band && ChoreographyLabelEditing.attrFor(band);
    if (isChoreographyTask(element) && attr && band !== 'name') {
      const { bounds, style } = this.bandBounds(element, band as 'top' | 'bottom');
      return {
        text: getAttribute(element, attr) ?? '',
        bounds,
        style,
        options: { centerVertically: true },
      };
    }
    return super.activate(element);
  }

  update(element: any, newLabel: any, activeContextText: any, bounds: any): void {
    const band: Band | undefined = element?._choreoBand;
    const attr = band && ChoreographyLabelEditing.attrFor(band);
    if (isChoreographyTask(element) && attr && band !== 'name') {
      const value = typeof newLabel === 'string' ? newLabel.trim() : '';
      setAttribute(element, attr, value, this.choreoModeling);
      return;
    }
    super.update(element, newLabel, activeContextText, bounds);
  }
}
