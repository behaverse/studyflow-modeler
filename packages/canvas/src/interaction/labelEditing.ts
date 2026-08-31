/**
 * Inline label editing (design §3 `interaction/labelEditing.ts`, §6 P3) — the
 * replacement for bpmn-js's `DirectEditing` + the modeler's
 * `ChoreographyLabelEditing`.
 *
 * A double click opens a plain HTML `<textarea>` overlay positioned over the label
 * region the renderer draws into — internal (inside the box) for tasks, external
 * (below) for events / gateways / data shapes, one of three bands for a choreography
 * task. The overlay is deliberately DOM-based rather than an SVG `foreignObject`, so
 * it is editable, focusable, and fully drivable under jsdom.
 *
 * On commit the new text is written straight onto the live business object through
 * moddle `set` (via {@link Writeback.setName} — which bumps {@link Scene.revision} and
 * fires `element.changed`), and the element is re-drawn. Nothing is re-serialized or
 * rebuilt: the very moddle object the scene was imported from is mutated, so
 * `bpmn-moddle` re-emits the edited name. `Escape` closes without writing anything.
 *
 * Choreography bands are edited fully: a band's text is the *participant*'s name, not
 * the task's, so a band commit writes `participantRef[0|1].name` — creating the two
 * `bpmn:Participant` objects (and, in a process-rooted document, the
 * `bpmn:Collaboration` that holds them) on first edit, exactly as the modeler's
 * `ensureChoreographyParticipants` does. That whole model half lives in
 * `model/choreography.ts` and is committed through {@link Writeback.setBandName}; this
 * module only decides *which* band the gesture landed on and where to put the overlay.
 */

import type { EventBus } from '@canvas/events/bus.ts';
import { isChoreographyTask, readChoreographyBands } from '@canvas/model/choreography.ts';
import { nameOf } from '@canvas/model/moddle.ts';
import type {
  Bounds,
  Point,
  Scene,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';
import type { Writeback } from '@canvas/model/writeback.ts';
import {
  EDGE_LABEL_FONT_SIZE,
  edgeLabelBounds,
  edgeLabelTextBounds,
  externalLabelBounds,
  INTERNAL_TOP_LABEL_HEIGHT,
  LABEL_FONT,
  LABEL_LINE_HEIGHT,
  measureLabelWidth,
} from '@canvas/render/labels.ts';
import { categoryOf } from '@canvas/render/renderer.ts';
import { choreographyBandHeight } from '@canvas/render/shapes.ts';
import { ownerDocument } from '@canvas/render/svg.ts';
import type { Viewport } from '@canvas/view/viewport.ts';

/**
 * Which text of an element is being edited. `'name'` is the ordinary element name;
 * `'top'`/`'bottom'` are the two choreography participant bands.
 */
export type LabelBand = 'name' | 'top' | 'bottom';

/** Payload for the `element.dblclick` event Canvas fires (mirrors bpmn-js's shape). */
export interface ElementDblClickEvent {
  element: SceneElement;
  originalEvent?: MouseEvent;
  /** Diagram-space point of the click. */
  point: Point;
}

/** Payload for `directEditing.activate` / `.complete` / `.cancel`. */
export interface DirectEditingEvent {
  element: SceneElement;
  band: LabelBand;
  /** The text the editor opened with. */
  initial: string;
  /** The committed text — `complete` only. */
  value?: string;
}

/** Construction dependencies for {@link LabelEditing}. */
export interface LabelEditingOptions {
  /** Host element the overlay is positioned inside (the canvas container). */
  container: HTMLElement;
  /** Screen↔diagram transforms and the current zoom. */
  viewport: Viewport;
  /** Bus `element.dblclick` / `directEditing.*` are fired on. */
  bus: EventBus;
  /** The live scene, or `undefined` before an import. */
  getScene: () => Scene | undefined;
  /** The writeback for the live scene, or `undefined` before an import. */
  getWriteback: () => Writeback | undefined;
  /** Re-draw these elements after a commit. */
  redraw: (elements: SceneElement[]) => void;
  /**
   * Hand the keyboard focus back to the diagram. Called only when the editor is
   * dismissed FROM the keyboard (Enter commits, Escape abandons) — a blur-driven
   * close means the focus already went somewhere the user chose, and stealing it
   * back would fight them.
   */
  restoreFocus?: () => void;
  /**
   * Hide (or restore) the element's DRAWN label for as long as the editor is open.
   * An internal editor is transparent (parity spec §5), so without this the old text
   * shows through the text being typed; bpmn-js solves it the same way, with a
   * marker class its stylesheet keys off (`djs-label-hidden`). Only the label goes —
   * a gateway keeps its ×.
   */
  setLabelHidden?: (element: SceneElement, hidden: boolean) => void;
}

/** The in-flight editing session. */
export interface LabelEditingSession {
  element: SceneElement;
  band: LabelBand;
  /** The text the editor was seeded with. */
  initial: string;
  /** Diagram-space region the overlay covers. */
  bounds: Bounds;
}

/** Options for {@link LabelEditing.activate}. */
export interface ActivateOptions {
  /** Force a band instead of deriving it from `at` (choreography tasks only). */
  band?: LabelBand;
  /** Diagram-space point of the gesture, used to pick a choreography band. */
  at?: Point;
}

/** Minimum on-screen size of the overlay, so a tiny shape is still typable. */
const MIN_EDITOR_PX = { width: 40, height: 16 };

/**
 * Minimum on-screen size of an EXTERNAL overlay. It is deliberately much smaller
 * than {@link MIN_EDITOR_PX}: that box is a white bordered chrome sized tight to the
 * text (parity spec §5 measured it at 14×16 px for the caption "go"), so a 40px floor
 * would be visible padding around every short label.
 */
const MIN_EXTERNAL_EDITOR_PX = { width: 14, height: 14 };

/**
 * Width (in DIAGRAM units) of the external editor opened on an element that has no
 * caption yet — `edge-videos/labels/frame_01`, where double-clicking a bare sequence
 * flow opens a comfortably wide empty box with a caret in it, not a hairline.
 *
 * Sizing tight to the text is right for a caption that EXISTS (ux-spec §5 measured
 * 14×16 px around "go"); applied to the empty string it produced a 14px sliver that
 * looked like a rendering fault rather than somewhere to type. bpmn-js draws the same
 * distinction — `LabelEditingProvider` falls back to a default 90-wide box exactly
 * when the element has no external label — and the box narrows to the text on the
 * first keystroke, which is what the reference shows next (`frame_02`).
 */
const EMPTY_EXTERNAL_EDITOR_WIDTH = 90;

/** The `7px` of `.sf-label-editor-internal`'s padding, as a number to compute with. */
const TEXT_PADDING_PX = 7;
/** `line-height: 1.2` of `.sf-label-editor`, likewise. */
const LINE_HEIGHT_RATIO = 1.2;

/**
 * Where an element's text is drawn relative to its shape — which decides the
 * editor's chrome (parity spec §5): `'internal'` is transparent and borderless over
 * the shape itself, `'external'` is a small white box with a `#ccc` border, tight to
 * the text, over the caption beside the shape.
 */
export type LabelPlacement = 'internal' | 'external';

/** Whether an element's text is drawn inside the shape or beside it. */
export function labelPlacement(element: SceneElement): LabelPlacement {
  // A connection's name is drawn beside the line as its own label element
  // (`render/labels.ts` `drawEdgeLabel`), so it takes the external chrome.
  if (element.kind === 'edge') return 'external';
  const node = element;
  // Every choreography band — the task name and both participant strips — is drawn
  // INSIDE the shape.
  if (isChoreographyTask(node)) return 'internal';
  switch (categoryOf(node.type)) {
    case 'event':
    case 'gateway':
    case 'data':
      return 'external';
    default:
      return 'internal';
  }
}

/**
 * The choreography band a diagram-space `point` falls in — top band, bottom band, or
 * the task-name region between them. Ports `ChoreographyLabelEditing.bandAt` without
 * its canvas/viewbox round-trip (the point is already in diagram coordinates).
 */
export function choreographyBandAt(node: SceneNode, point: Point): LabelBand {
  const band = choreographyBandHeight(node.height);
  const rel = point.y - node.y;
  if (rel <= band) return 'top';
  if (rel >= node.height - band) return 'bottom';
  return 'name';
}

/**
 * The diagram-space region an element's `band` text occupies — the box the inline
 * editor opens over. Mirrors `render/renderer.ts`'s drawer dispatch so the editor
 * always lands on the drawn text.
 */
export function labelBounds(element: SceneElement, band: LabelBand): Bounds {
  // A connection's caption hangs off the middle segment of its polyline
  // (`edgeLabelBounds`), which is the region `drawEdgeLabel` paints into.
  if (element.kind === 'edge') {
    return edgeLabelBounds(element, nameOf(element.businessObject), element.label);
  }
  const node = element;
  if (isChoreographyTask(node)) {
    const h = choreographyBandHeight(node.height);
    if (band === 'top') return { x: node.x, y: node.y, width: node.width, height: h };
    if (band === 'bottom') {
      return { x: node.x, y: node.y + node.height - h, width: node.width, height: h };
    }
    return { x: node.x, y: node.y + h, width: node.width, height: node.height - 2 * h };
  }

  switch (categoryOf(node.type)) {
    case 'event':
    case 'gateway':
    case 'data':
      return externalLabelBounds(node, node.label);
    case 'participant':
      // The vertical title band on the left (`Renderer.drawParticipantLabel`).
      return { x: node.x, y: node.y, width: Math.min(30, node.width), height: node.height };
    default:
      // An expanded container captions its top strip, not its middle
      // (`render/labels.ts`), so the editor opens over the strip — otherwise the
      // text jumps to the centre of the frame the moment it is edited.
      return node.isExpanded === true
        ? { x: node.x, y: node.y, width: node.width, height: INTERNAL_TOP_LABEL_HEIGHT }
        : { x: node.x, y: node.y, width: node.width, height: node.height };
  }
}

/**
 * The diagram-space box the OVERLAY covers, which is not always the label region:
 *
 * - internal — the region itself (the shape's own box), so the text stays where it
 *   is drawn and the chrome is invisible;
 * - external — a box sized tight to `text` and centred on the region, because the
 *   external editor is a visible white box (parity spec §5: the reference measured
 *   14×16 px around the two-letter caption "go", not the whole label region).
 *
 * `minWidth` (diagram units) raises the floor for the whole session when the element
 * had NO caption to begin with — {@link EMPTY_EXTERNAL_EDITOR_WIDTH}, so naming a
 * bare sequence flow starts in a real box and does not jump around as it is typed
 * (`edge-videos/labels/frame_01` → `frame_02`, where the box is the same size before
 * and after "Hello.").
 *
 * Exported so the geometry can be asserted directly, and so a host that positions
 * its own editor gets the same answer.
 */
export function editorBounds(
  element: SceneElement,
  band: LabelBand,
  text: string,
  minWidth = MIN_EXTERNAL_EDITOR_PX.width,
): Bounds {
  const region = labelBounds(element, band);
  if (labelPlacement(element) === 'internal') return region;
  const fontSize = fontSizeFor(element, band);
  const lines = text.split(/\r?\n/);
  const width = Math.max(
    minWidth,
    ...lines.map((line) => measureLabelWidth(line, fontSize)),
  );
  const height = Math.max(1, lines.length) * LABEL_LINE_HEIGHT;
  return {
    x: region.x + region.width / 2 - width / 2,
    y: region.y + region.height / 2 - height / 2,
    width,
    height,
  };
}

/** Font size (diagram units) the drawer uses for a band, matched by the overlay. */
function fontSizeFor(element: SceneElement, band: LabelBand): number {
  if (element.kind === 'edge') return EDGE_LABEL_FONT_SIZE;
  const node = element;
  if (isChoreographyTask(node)) return band === 'name' ? 12 : 11;
  switch (categoryOf(node.type)) {
    case 'event':
    case 'gateway':
    case 'data':
      return 11;
    default:
      return 12;
  }
}

/**
 * Weight the overlay's text is set in — the ONE weight every label the renderer
 * draws uses (`render/labels.ts`: `textLine` defaults to `400`, `drawInternalLabel`
 * pins `400`, the choreography bands pass `'400'`), and the weight parity spec §1
 * measured on the reference for both an internal task label and an external caption.
 *
 * It is a constant rather than a per-band function on purpose: the moment the two
 * disagree the text visibly thickens or thins as the editor opens, which is exactly
 * the regression the pre-`400` renderer left behind here.
 */
const LABEL_FONT_WEIGHT = '400';

// --- the editor -------------------------------------------------------------

/**
 * The inline label editor. One instance per {@link Canvas}; at most one session is
 * open at a time.
 */
export class LabelEditing {
  private readonly container: HTMLElement;
  private readonly viewport: Viewport;
  private readonly bus: EventBus;
  private readonly getScene: () => Scene | undefined;
  private readonly getWriteback: () => Writeback | undefined;
  private readonly redraw: (elements: SceneElement[]) => void;
  private readonly restoreFocus?: () => void;
  private readonly setLabelHidden?: (element: SceneElement, hidden: boolean) => void;

  private session?: LabelEditingSession;
  private input?: HTMLTextAreaElement;
  /** Guards the blur→complete path while the overlay is being torn down. */
  private closing = false;

  private readonly onKeyDown = (ev: Event) => this.handleKeyDown(ev as KeyboardEvent);
  private readonly onBlur = () => {
    if (!this.closing) this.complete();
  };
  /**
   * Re-fit as the text changes: an external box is sized to its content, and an
   * internal one keeps its text vertically centred as lines are added.
   */
  private readonly onInput = () => {
    const session = this.session;
    const input = this.input;
    if (!session || !input) return;
    this.place(input, session.element, session.band, input.value, session.bounds, session.initial);
  };

  constructor(options: LabelEditingOptions) {
    this.container = options.container;
    this.viewport = options.viewport;
    this.bus = options.bus;
    this.getScene = options.getScene;
    this.getWriteback = options.getWriteback;
    this.redraw = options.redraw;
    this.restoreFocus = options.restoreFocus;
    this.setLabelHidden = options.setLabelHidden;
  }

  /** Whether an editing session is open. */
  isActive(): boolean {
    return !!this.session;
  }

  /** The in-flight session, or `undefined`. */
  getSession(): LabelEditingSession | undefined {
    return this.session;
  }

  /** The overlay `<textarea>`, or `undefined` when no session is open. */
  getInput(): HTMLTextAreaElement | undefined {
    return this.input;
  }

  /** The editor's current text, or `undefined` when no session is open. */
  getValue(): string | undefined {
    return this.input?.value;
  }

  /** Replace the editor's text (what a test's "typing" does). */
  setValue(text: string): void {
    if (this.input) this.input.value = text;
  }

  /** Close any open session (called on a fresh import). */
  reset(): void {
    this.cancel();
  }

  /**
   * The node whose *external* label box contains a diagram-space `point`. Labels are
   * drawn inside their owner's `<g>` and are not separate hit targets, so this is how
   * a double click on the text below an event finds the event.
   */
  labelTargetAt(point: Point): SceneNode | undefined {
    const scene = this.getScene();
    if (!scene) return undefined;
    for (const element of scene.elementsById.values()) {
      if (element.kind !== 'node') continue;
      const category = categoryOf(element.type);
      if (category !== 'event' && category !== 'gateway' && category !== 'data') continue;
      if (!nameOf(element.businessObject)) continue;
      const box = externalLabelBounds(element, element.label);
      if (
        point.x >= box.x && point.x <= box.x + box.width
        && point.y >= box.y && point.y <= box.y + box.height
      ) {
        return element;
      }
    }
    return undefined;
  }

  /**
   * Open the editor over `element`'s label — a shape's own text, a caption beside it,
   * or a CONNECTION's name (double-clicking a sequence flow's caption opens it
   * pre-filled, exactly as the reference does). A choreography task picks its band
   * from `options.band`, else from `options.at`, else the name band. Returns whether
   * a session opened.
   */
  activate(target: SceneElement, options: ActivateOptions = {}): boolean {
    if (this.session) this.complete();
    // A caption edits the element it names: double-clicking the label under an event
    // opens the same editor double-clicking the event does (parity spec §5), and the
    // session reports the OWNER, which is what carries the name being written.
    const element = target.labelTarget ?? target;

    const band: LabelBand = element.kind === 'node' && isChoreographyTask(element)
      ? (options.band ?? (options.at ? choreographyBandAt(element, options.at) : 'name'))
      : 'name';
    const initial = this.textOf(element, band);
    const bounds = labelBounds(element, band);

    this.session = { element, band, initial, bounds };
    // The drawn label steps aside while the (transparent) editor stands in for it.
    this.setLabelHidden?.(element, true);
    this.input = this.createInput(element, band, initial, bounds);
    this.bus.fire<DirectEditingEvent>('directEditing.activate', { element, band, initial });
    return true;
  }

  /**
   * Commit the editor's text and close. Writes the new name onto the live moddle
   * object (the element's business object, or the band's participant) through
   * {@link Writeback.setName}, then re-draws the element. Returns whether anything
   * changed.
   */
  complete(): boolean {
    const session = this.session;
    const value = this.input?.value ?? '';
    if (!session) return false;
    this.close();

    const affected = this.write(session, value);
    this.bus.fire<DirectEditingEvent>('directEditing.complete', {
      element: session.element,
      band: session.band,
      initial: session.initial,
      value,
    });
    if (affected.length > 0) this.redraw(affected);
    return affected.length > 0;
  }

  /** Close the editor without writing anything (Escape). */
  cancel(): void {
    const session = this.session;
    if (!session) return;
    this.close();
    this.bus.fire<DirectEditingEvent>('directEditing.cancel', {
      element: session.element,
      band: session.band,
      initial: session.initial,
    });
  }

  /** Remove the overlay and forget the session (no model side effects). */
  private close(): void {
    this.closing = true;
    if (this.session) this.setLabelHidden?.(this.session.element, false);
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

  /** The text a band opens with. */
  private textOf(element: SceneElement, band: LabelBand): string {
    if (band === 'name') return nameOf(element.businessObject);
    const bands = readChoreographyBands(element.businessObject);
    return band === 'top' ? bands.top : bands.bottom;
  }

  /**
   * Apply a committed value. Returns the elements whose drawn text the edit
   * invalidated — empty when nothing changed. Usually that is just the edited
   * element, but a renamed choreography *participant* is depicted by a band on every
   * task that references it, and all of those go stale at once.
   */
  private write(session: LabelEditingSession, value: string): SceneElement[] {
    const writeback = this.getWriteback();
    const element = session.element;
    if (!writeback) return [];
    const text = value.trim();

    if (session.band === 'name') {
      // A connection that is GAINING a caption gains a `bpmndi:BPMNLabel` with it,
      // exactly as bpmn-js's `LabelBehavior` mints one the moment a flow is named
      // (parity spec addendum 3 §1/§5). Without it the new caption has no position
      // of its own: it is derived from the waypoints, so re-routing the flow drags
      // it around and dragging the label has nothing to write.
      //
      // Minted `silent`, so the mint and the name are ONE revision bump and
      // therefore one undo step — the user typed a label, not two edits.
      if (
        element.kind === 'edge'
        && text
        && !element.label
        && text !== nameOf(element.businessObject)
      ) {
        writeback.setLabelBounds(element, edgeLabelTextBounds(element, text), { silent: true });
      }
      return writeback.setName(element, text) ? [element] : [];
    }
    // Only a choreography task (a node) has bands at all.
    if (element.kind !== 'node') return [];
    // A band's text belongs to the *participant*, not the choreography task, and one
    // participant is depicted by a band on every task that references it — so the
    // whole model half (mint the pair, write the name, report the stale depictions)
    // is `Writeback.setBandName`, which returns exactly what has to be re-drawn.
    return writeback.setBandName(element, session.band, text);
  }

  /**
   * Build, position, mount, and focus the overlay `<textarea>`.
   *
   * The overlay carries NO paint of its own: `view/theme.ts` styles
   * `.sf-label-editor` plus one of `.sf-label-editor-internal` (transparent,
   * borderless, `7px 5px` padding — the text simply becomes editable in place) and
   * `.sf-label-editor-external` (white, 1px `#ccc` border), which is the two-variant
   * chrome of parity spec §5. Only what the viewport decides — where the box is, how
   * big it is, and the zoom-scaled font — is written inline here.
   */
  private createInput(
    element: SceneElement,
    band: LabelBand,
    initial: string,
    bounds: Bounds,
  ): HTMLTextAreaElement {
    const doc = this.container.ownerDocument ?? ownerDocument();
    const placement = labelPlacement(element);
    const input = doc.createElement('textarea');
    input.className = `sf-label-editor sf-label-editor-${placement}`;
    input.setAttribute('data-element-id', element.id);
    input.setAttribute('data-band', band);
    input.setAttribute('data-placement', placement);
    input.value = initial;
    input.rows = 1;
    input.spellcheck = false;

    // The container is the positioning context for the absolutely placed overlay.
    if (this.container.style.position === '') this.container.style.position = 'relative';

    Object.assign(input.style, {
      fontFamily: LABEL_FONT,
      fontSize: `${fontSizeFor(element, band) * this.scale()}px`,
      fontWeight: LABEL_FONT_WEIGHT,
    });
    this.place(input, element, band, initial, bounds, initial);

    input.addEventListener('keydown', this.onKeyDown);
    input.addEventListener('input', this.onInput);
    input.addEventListener('blur', this.onBlur);
    this.container.appendChild(input);
    input.focus?.();
    // A CARET at the end of the text, not the whole text selected: the reference
    // editor opens the same way (`diagram-js-direct-editing`'s TextBox collapses its
    // range onto `content.lastChild`), so the label reads as plain text the moment it
    // becomes editable instead of flashing a blue selection band over itself.
    input.setSelectionRange?.(initial.length, initial.length);
    return input;
  }

  /**
   * Position and size the overlay over the text it edits. An external box is sized
   * tight to its content ({@link editorBounds}), so it is re-placed on every
   * keystroke — the box grows with the caption and stays centred on it, which is
   * what keeps a white 1px-bordered box from looking like a form field.
   *
   * `initial` is the text the SESSION opened with, not the text being placed: an
   * element that had no caption keeps the wider empty-box floor for as long as it is
   * being named, so the box does not snap from wide to hairline on the first
   * keystroke ({@link EMPTY_EXTERNAL_EDITOR_WIDTH}).
   */
  private place(
    input: HTMLTextAreaElement,
    element: SceneElement,
    band: LabelBand,
    text: string,
    region: Bounds,
    initial = text,
  ): void {
    const placement = labelPlacement(element);
    const floor = initial === '' ? EMPTY_EXTERNAL_EDITOR_WIDTH : undefined;
    const bounds = placement === 'internal'
      ? region
      : editorBounds(element, band, text, floor);
    const min = placement === 'internal' ? MIN_EDITOR_PX : MIN_EXTERNAL_EDITOR_PX;
    const box = this.viewport.getAbsoluteBBox(bounds);
    const host = this.container.getBoundingClientRect();
    const width = Math.max(min.width, box.width);
    const height = Math.max(min.height, box.height);
    Object.assign(input.style, {
      left: `${box.x - host.left + (box.width - width) / 2}px`,
      top: `${box.y - host.top + (box.height - height) / 2}px`,
      width: `${width}px`,
      height: `${height}px`,
      // An internal editor covers the WHOLE shape (parity spec §5 pins the parent
      // rect to the shape bbox), but its text has to sit where the label is drawn —
      // vertically centred. bpmn-js gets that from `centerVertically`, which absolutely
      // positions its content div at `top: 50%; translateY(-50%)`; a <textarea> has no
      // such handle, so the same centring is expressed as top padding, recomputed as
      // lines are added. The floor is the 7px the spec measured.
      ...(placement === 'internal'
        ? { paddingTop: `${this.centeringPad(input, text, height)}px` }
        : {}),
    });
  }

  /** Top padding that centres `text` in a `height`-tall internal editor. */
  private centeringPad(input: HTMLTextAreaElement, text: string, height: number): number {
    const fontSize = parseFloat(input.style.fontSize) || 12;
    const lines = Math.max(1, text.split(/\r?\n/).length);
    return Math.max(TEXT_PADDING_PX, (height - lines * fontSize * LINE_HEIGHT_RATIO) / 2);
  }

  /** Screen pixels per diagram unit, guarded against a zero/absent layout. */
  private scale(): number {
    const scale = this.viewport.getViewbox().scale;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  private handleKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.cancel();
      this.restoreFocus?.();
      return;
    }
    // Enter commits; Shift+Enter (or Ctrl/Meta+Enter) inserts a line break.
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      ev.stopPropagation();
      this.complete();
      this.restoreFocus?.();
    }
  }
}
