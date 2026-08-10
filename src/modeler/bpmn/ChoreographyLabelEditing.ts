import LabelEditingProvider from 'bpmn-js/lib/features/label-editing/LabelEditingProvider';
import { readChoreographyBands } from '@/core/document';
import { ensureChoreographyParticipants } from '@/modeler/bpmn/choreographyParticipants';
import { choreographyBandHeight, isChoreographyTask } from '@/modeler/draw/choreographyLayout';

/** Runs before bpmn-js's own dblclick handler so the band is known on activate. */
const BAND_STAMP_PRIORITY = 2000;

type Band = 'top' | 'bottom' | 'name';

type ChoreoShape = { _choreoBand?: Band; x: number; y: number; height: number };


export default class ChoreographyLabelEditing extends LabelEditingProvider {
  static $inject = [
    'eventBus', 'bpmnFactory', 'canvas', 'directEditing',
    'modeling', 'resizeHandles', 'textRenderer',
  ];

  private choreoCanvas: any;
  private choreoModeling: any;
  private choreoBpmnFactory: any;
  private choreoTextRenderer: any;
  private activeBand: Band | undefined;

  constructor(
    eventBus: any, bpmnFactory: any, canvas: any, directEditing: any,
    modeling: any, resizeHandles: any, textRenderer: any,
  ) {
    super(eventBus, bpmnFactory, canvas, directEditing, modeling, resizeHandles, textRenderer);
    this.choreoCanvas = canvas;
    this.choreoModeling = modeling;
    this.choreoBpmnFactory = bpmnFactory;
    this.choreoTextRenderer = textRenderer;

    eventBus.on('element.dblclick', BAND_STAMP_PRIORITY, (event: any) => {
      const element = event.element as ChoreoShape | undefined;
      if (!element) return;
      element._choreoBand = isChoreographyTask(element)
        ? this.bandAt(element, event.originalEvent)
        : undefined;
    });
  }

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


  /** Screen space, unlike `bandAt`'s diagram-local coordinates. */
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
        fontFamily: this.choreoTextRenderer.getDefaultStyle().fontFamily,
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

    const bands = readChoreographyBands(element.businessObject);
    const text = band === 'top' ? bands.top
      : band === 'bottom' ? bands.bottom
      : (element.businessObject?.name ?? '');
    const { bounds, style } = this.regionBounds(element, band);
    return { text, bounds, style, options: { centerVertically: true } };
  }

  update(element: any, newLabel: any, activeContextText: any, bounds: any): void {
    const band = isChoreographyTask(element) ? this.activeBand : undefined;
    this.activeBand = undefined;

    if (band === 'top' || band === 'bottom') {
      const value = typeof newLabel === 'string' ? newLabel.trim() : '';
      const [top, bottom] = ensureChoreographyParticipants(element, this.choreoModeling, this.choreoBpmnFactory);
      const participant = band === 'top' ? top : bottom;
      this.choreoModeling.updateModdleProperties(element, participant, { name: value });
      return;
    }
    super.update(element, newLabel, activeContextText, bounds);
  }
}
