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
import { externalLabelBounds, LABEL_FONT } from '@canvas/render/labels.ts';
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
export function labelBounds(node: SceneNode, band: LabelBand): Bounds {
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
      return { x: node.x, y: node.y, width: node.width, height: node.height };
  }
}

/** Font size (diagram units) the drawer uses for a band, matched by the overlay. */
function fontSizeFor(node: SceneNode, band: LabelBand): number {
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

function fontWeightFor(node: SceneNode, band: LabelBand): string {
  if (isChoreographyTask(node)) return band === 'name' ? '600' : '400';
  switch (categoryOf(node.type)) {
    case 'event':
    case 'gateway':
    case 'data':
      return '400';
    default:
      return '600';
  }
}

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

  private session?: LabelEditingSession;
  private input?: HTMLTextAreaElement;
  /** Guards the blur→complete path while the overlay is being torn down. */
  private closing = false;

  private readonly onKeyDown = (ev: Event) => this.handleKeyDown(ev as KeyboardEvent);
  private readonly onBlur = () => {
    if (!this.closing) this.complete();
  };

  constructor(options: LabelEditingOptions) {
    this.container = options.container;
    this.viewport = options.viewport;
    this.bus = options.bus;
    this.getScene = options.getScene;
    this.getWriteback = options.getWriteback;
    this.redraw = options.redraw;
    this.restoreFocus = options.restoreFocus;
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
   * Open the editor over `element`'s label. A choreography task picks its band from
   * `options.band`, else from `options.at`, else the name band. Returns whether a
   * session opened — edges carry no drawn label yet (routing/edge labels are a later
   * phase), so they are declined.
   */
  activate(element: SceneElement, options: ActivateOptions = {}): boolean {
    if (this.session) this.complete();
    if (element.kind !== 'node') return false;

    const band: LabelBand = isChoreographyTask(element)
      ? (options.band ?? (options.at ? choreographyBandAt(element, options.at) : 'name'))
      : 'name';
    const initial = this.textOf(element, band);
    const bounds = labelBounds(element, band);

    this.session = { element, band, initial, bounds };
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
    const input = this.input;
    if (input) {
      input.removeEventListener('keydown', this.onKeyDown);
      input.removeEventListener('blur', this.onBlur);
      input.parentNode?.removeChild(input);
    }
    this.input = undefined;
    this.session = undefined;
    this.closing = false;
  }

  /** The text a band opens with. */
  private textOf(node: SceneNode, band: LabelBand): string {
    if (band === 'name') return nameOf(node.businessObject);
    const bands = readChoreographyBands(node.businessObject);
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
    if (!writeback || element.kind !== 'node') return [];
    const text = value.trim();

    if (session.band === 'name') return writeback.setName(element, text) ? [element] : [];
    // A band's text belongs to the *participant*, not the choreography task, and one
    // participant is depicted by a band on every task that references it — so the
    // whole model half (mint the pair, write the name, report the stale depictions)
    // is `Writeback.setBandName`, which returns exactly what has to be re-drawn.
    return writeback.setBandName(element, session.band, text);
  }

  /** Build, position, mount, and focus the overlay `<textarea>`. */
  private createInput(
    node: SceneNode,
    band: LabelBand,
    initial: string,
    bounds: Bounds,
  ): HTMLTextAreaElement {
    const doc = this.container.ownerDocument ?? ownerDocument();
    const input = doc.createElement('textarea');
    input.className = 'sf-label-editor';
    input.setAttribute('data-element-id', node.id);
    input.setAttribute('data-band', band);
    input.value = initial;
    input.rows = 1;
    input.spellcheck = false;

    const scale = this.scale();
    const box = this.viewport.getAbsoluteBBox(bounds);
    const host = this.container.getBoundingClientRect();
    // The container is the positioning context for the absolutely placed overlay.
    if (this.container.style.position === '') this.container.style.position = 'relative';

    Object.assign(input.style, {
      position: 'absolute',
      left: `${box.x - host.left}px`,
      top: `${box.y - host.top}px`,
      width: `${Math.max(MIN_EDITOR_PX.width, box.width)}px`,
      height: `${Math.max(MIN_EDITOR_PX.height, box.height)}px`,
      boxSizing: 'border-box',
      margin: '0',
      padding: '1px 2px',
      border: '1px solid #1a73e8',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      background: '#ffffff',
      color: '#22242A',
      textAlign: 'center',
      lineHeight: '1.2',
      fontFamily: LABEL_FONT,
      fontSize: `${fontSizeFor(node, band) * scale}px`,
      fontWeight: fontWeightFor(node, band),
      zIndex: '10',
    });

    input.addEventListener('keydown', this.onKeyDown);
    input.addEventListener('blur', this.onBlur);
    this.container.appendChild(input);
    input.focus?.();
    input.select?.();
    return input;
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
