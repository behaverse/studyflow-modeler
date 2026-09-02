/**
 * Inline label editing: a `<textarea>` overlay over the text being edited —
 * transparent over a shape's own name, a small box over an external caption or a
 * choreography band. Enter commits, Escape abandons.
 */

import type { EventBus } from '@core/events/bus.ts';
import { isChoreographyTask, readChoreographyBands } from '@canvas/model/choreography.ts';
import { hasExternalLabel } from '@canvas/model/labels.ts';
import { nameOf } from '@canvas/model/moddle.ts';
import type { Mutator } from '@canvas/model/mutator.ts';
import type { Bounds, Point, SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import {
  edgeLabelBox,
  FONT,
  internalLabelRegion,
  LABEL_FONT,
  LINE_HEIGHT,
  nodeLabelBox,
  textWidth,
  WEIGHT,
} from '@canvas/render/labels.ts';
import { choreographyBandHeight } from '@canvas/render/shapes.ts';
import { ownerDocument } from '@canvas/render/svg.ts';
import type { Viewport } from '@canvas/view/viewport.ts';

export type LabelBand = 'name' | 'top' | 'bottom';
export type LabelPlacement = 'internal' | 'external';

export interface ElementDblClickEvent {
  element: SceneElement;
  originalEvent?: MouseEvent;
  point: Point;
}

export interface DirectEditingEvent {
  element: SceneNode | SceneEdge;
  band: LabelBand;
  initial: string;
  value?: string;
}

export interface LabelEditingOptions {
  container: HTMLElement;
  viewport: Viewport;
  bus: EventBus;
  getMutator: () => Mutator | undefined;
  redraw: (elements: SceneElement[]) => void;
  restoreFocus?: () => void;
  /** Hide the drawn text while the transparent editor stands in for it. */
  setLabelHidden?: (element: SceneElement, hidden: boolean) => void;
}

export interface LabelEditingSession {
  element: SceneNode | SceneEdge;
  band: LabelBand;
  initial: string;
  bounds: Bounds;
}

const MIN_INTERNAL_PX = { width: 40, height: 16 };
const MIN_EXTERNAL_PX = { width: 14, height: 14 };
const EMPTY_EXTERNAL_WIDTH = 90;

export function labelPlacement(element: SceneNode | SceneEdge): LabelPlacement {
  if (element.kind === 'node' && isChoreographyTask(element)) return 'internal';
  return hasExternalLabel(element) ? 'external' : 'internal';
}

export function choreographyBandAt(node: SceneNode, point: Point): LabelBand {
  const band = choreographyBandHeight(node.height);
  const rel = point.y - node.y;
  if (rel <= band) return 'top';
  if (rel >= node.height - band) return 'bottom';
  return 'name';
}

/** The diagram-space region the text of `band` occupies. */
export function labelBounds(element: SceneNode | SceneEdge, band: LabelBand): Bounds {
  if (element.kind === 'edge') return element.label ?? edgeLabelBox(element, nameOf(element.businessObject) || 'x');
  const node = element;
  if (isChoreographyTask(node)) {
    const h = choreographyBandHeight(node.height);
    if (band === 'top') return { x: node.x, y: node.y, width: node.width, height: h };
    if (band === 'bottom') return { x: node.x, y: node.y + node.height - h, width: node.width, height: h };
    return { x: node.x, y: node.y + h, width: node.width, height: node.height - 2 * h };
  }
  if (hasExternalLabel(node)) return node.label ?? nodeLabelBox(node, nameOf(node.businessObject) || 'x');
  const region = internalLabelRegion(node);
  return { x: node.x + region.x, y: node.y + region.y, width: region.width, height: region.height };
}

function fontSizeFor(element: SceneNode | SceneEdge, band: LabelBand): number {
  if (element.kind === 'edge') return FONT.external;
  if (isChoreographyTask(element)) return band === 'name' ? FONT.internal : FONT.band;
  return hasExternalLabel(element) ? FONT.external : FONT.internal;
}

/** An external editor is sized tight to `text`, centred on the label region. */
function editorBounds(element: SceneNode | SceneEdge, band: LabelBand, text: string, minWidth: number): Bounds {
  const region = labelBounds(element, band);
  if (labelPlacement(element) === 'internal') return region;
  const fontSize = fontSizeFor(element, band);
  const lines = text.split(/\r?\n/);
  const width = Math.max(minWidth, ...lines.map((line) => textWidth(line, fontSize)));
  const height = Math.max(1, lines.length) * LINE_HEIGHT;
  return { x: region.x + region.width / 2 - width / 2, y: region.y + region.height / 2 - height / 2, width, height };
}

export class LabelEditing {
  private readonly options: LabelEditingOptions;
  private session?: LabelEditingSession;
  private input?: HTMLTextAreaElement;
  private closing = false;
  private readonly onKeyDown = (ev: Event) => this.handleKeyDown(ev as KeyboardEvent);
  private readonly onBlur = () => {
    if (!this.closing) this.complete();
  };
  private readonly onInput = () => {
    if (this.session && this.input) this.place(this.input, this.session, this.input.value);
  };

  constructor(options: LabelEditingOptions) {
    this.options = options;
  }

  isActive(): boolean {
    return !!this.session;
  }

  getSession(): LabelEditingSession | undefined {
    return this.session;
  }

  getInput(): HTMLTextAreaElement | undefined {
    return this.input;
  }

  getValue(): string | undefined {
    return this.input?.value;
  }

  setValue(text: string): void {
    if (this.input) this.input.value = text;
  }

  reset(): void {
    this.cancel();
  }

  /** Open the editor over `target`'s text; a label edits the element it names. */
  activate(target: SceneElement, options: { band?: LabelBand; at?: Point } = {}): boolean {
    if (this.session) this.complete();
    const element = target.kind === 'label' ? target.owner : target;
    const band: LabelBand = element.kind === 'node' && isChoreographyTask(element)
      ? (options.band ?? (options.at ? choreographyBandAt(element, options.at) : 'name'))
      : 'name';
    const initial = this.textOf(element, band);
    const session: LabelEditingSession = { element, band, initial, bounds: labelBounds(element, band) };
    this.session = session;
    this.options.setLabelHidden?.(element.kind === 'node' || element.kind === 'edge' ? element.label ?? element : element, true);
    if (element.label && labelPlacement(element) === 'external') this.options.setLabelHidden?.(element.label, true);
    this.input = this.createInput(session);
    this.options.bus.fire('DirectEditingActivate', { element, band, initial } satisfies DirectEditingEvent);
    return true;
  }

  complete(): boolean {
    const session = this.session;
    const value = this.input?.value ?? '';
    if (!session) return false;
    this.close();
    const affected = this.write(session, value);
    this.options.bus.fire('DirectEditingComplete', { element: session.element, band: session.band, initial: session.initial, value } satisfies DirectEditingEvent);
    if (affected.length > 0) this.options.redraw(affected);
    return affected.length > 0;
  }

  cancel(): void {
    const session = this.session;
    if (!session) return;
    this.close();
    this.options.bus.fire('DirectEditingCancel', { element: session.element, band: session.band, initial: session.initial } satisfies DirectEditingEvent);
  }

  private close(): void {
    this.closing = true;
    const session = this.session;
    if (session) {
      this.options.setLabelHidden?.(session.element, false);
      if (session.element.label) this.options.setLabelHidden?.(session.element.label, false);
    }
    const input = this.input;
    if (input) {
      input.removeEventListener('keydown', this.onKeyDown);
      input.removeEventListener('input', this.onInput);
      input.removeEventListener('blur', this.onBlur);
      input.parentNode?.removeChild(input);
    }
    this.input = undefined;
    this.session = undefined;
    this.closing = false;
  }

  private textOf(element: SceneNode | SceneEdge, band: LabelBand): string {
    if (band === 'name') return nameOf(element.businessObject);
    const bands = readChoreographyBands(element.businessObject);
    return band === 'top' ? bands.top : bands.bottom;
  }

  private write(session: LabelEditingSession, value: string): SceneElement[] {
    const mutator = this.options.getMutator();
    if (!mutator) return [];
    const text = value.trim();
    const element = session.element;
    if (session.band === 'name') return mutator.setName(element, text) ? [element] : [];
    if (element.kind !== 'node') return [];
    return mutator.setBandName(element, session.band, text);
  }

  private createInput(session: LabelEditingSession): HTMLTextAreaElement {
    const { container } = this.options;
    const doc = container.ownerDocument ?? ownerDocument();
    const placement = labelPlacement(session.element);
    const input = doc.createElement('textarea');
    input.className = `sf-label-editor sf-label-editor-${placement}`;
    input.setAttribute('data-element-id', session.element.id);
    input.setAttribute('data-band', session.band);
    input.value = session.initial;
    input.rows = 1;
    input.spellcheck = false;
    if (container.style.position === '') container.style.position = 'relative';
    Object.assign(input.style, {
      fontFamily: LABEL_FONT,
      fontSize: `${fontSizeFor(session.element, session.band) * this.scale()}px`,
      fontWeight: placement === 'internal' ? WEIGHT.internal : WEIGHT.external,
    });
    this.place(input, session, session.initial);
    input.addEventListener('keydown', this.onKeyDown);
    input.addEventListener('input', this.onInput);
    input.addEventListener('blur', this.onBlur);
    container.appendChild(input);
    input.focus?.();
    input.setSelectionRange?.(session.initial.length, session.initial.length);
    return input;
  }

  private place(input: HTMLTextAreaElement, session: LabelEditingSession, text: string): void {
    const { element, band } = session;
    const placement = labelPlacement(element);
    const bounds = placement === 'internal'
      ? session.bounds
      : editorBounds(element, band, text, session.initial === '' ? EMPTY_EXTERNAL_WIDTH : MIN_EXTERNAL_PX.width);
    const min = placement === 'internal' ? MIN_INTERNAL_PX : MIN_EXTERNAL_PX;
    const box = this.options.viewport.getAbsoluteBBox(bounds);
    const host = this.options.container.getBoundingClientRect();
    const width = Math.max(min.width, box.width);
    const height = Math.max(min.height, box.height);
    Object.assign(input.style, {
      left: `${box.x - host.left + (box.width - width) / 2}px`,
      top: `${box.y - host.top + (box.height - height) / 2}px`,
      width: `${width}px`,
      height: `${height}px`,
      ...(placement === 'internal' ? { paddingTop: `${this.centeringPad(input, text, height)}px` } : {}),
    });
  }

  private centeringPad(input: HTMLTextAreaElement, text: string, height: number): number {
    const fontSize = parseFloat(input.style.fontSize) || 12;
    const lines = Math.max(1, text.split(/\r?\n/).length);
    return Math.max(6, (height - lines * fontSize * 1.2) / 2);
  }

  private scale(): number {
    const scale = this.options.viewport.getViewbox().scale;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  private handleKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.cancel();
      this.options.restoreFocus?.();
      return;
    }
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      ev.stopPropagation();
      this.complete();
      this.options.restoreFocus?.();
    }
  }
}
