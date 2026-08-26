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
 * `ensureChoreographyParticipants` does.
 */

import { BPMN } from '@core/constants.ts';

import type { EventBus } from '@canvas/events/bus.ts';
import { IdGenerator } from '@canvas/model/ids.ts';
import type {
  Bounds,
  ModdleObject,
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

/** Read a moddle property, tolerating a plain parsed bag (mirrors `writeback.ts`). */
function prop(target: ModdleObject | undefined, name: string): unknown {
  if (!target) return undefined;
  const getter = (target as { get?: (n: string) => unknown }).get;
  return typeof getter === 'function'
    ? getter.call(target, name)
    : (target as Record<string, unknown>)[name];
}

/** Set a moddle property via its `set`, else assign directly (mirrors `writeback.ts`). */
function setProp(target: ModdleObject, name: string, value: unknown): void {
  const setter = (target as { set?: (n: string, v: unknown) => void }).set;
  if (typeof setter === 'function') setter.call(target, name, value);
  else (target as Record<string, unknown>)[name] = value;
}

/** The element's `name`, as a string (`''` when absent). */
export function nameOf(bo: ModdleObject | undefined): string {
  const value = prop(bo, 'name');
  return typeof value === 'string' ? value : '';
}

/** Whether `node` is drawn as a choreography task (two bands + a name band). */
export function isChoreographyTask(node: SceneNode): boolean {
  return node.type === BPMN.ChoreographyTask;
}

/**
 * Placeholder band names for a choreography task with no participants yet. Mirrors
 * `@core/document/choreography`'s `DEFAULT_TOP`/`DEFAULT_BOTTOM` — kept as local
 * constants (and pinned by a test) rather than imported, because that core module
 * pulls the whole document/format layer, and its `bpmn-moddle` types, into a package
 * that must stay a leaf.
 */
export const DEFAULT_TOP = 'Participant A';
/** @see DEFAULT_TOP */
export const DEFAULT_BOTTOM = 'Participant B';

/**
 * The two band names of a choreography task plus which side initiates — a local
 * mirror of `@core/document/choreography`'s `readChoreographyBands`, including its
 * fallback to the placeholder names when a participant carries none.
 */
export function readChoreographyBands(bo: ModdleObject): {
  top: string;
  bottom: string;
  initiator: 'top' | 'bottom';
} {
  const refs = prop(bo, 'participantRef');
  const list = Array.isArray(refs) ? (refs as ModdleObject[]) : [];
  const top = list[0];
  const bottom = list[1];
  const initiating = prop(bo, 'initiatingParticipantRef');
  return {
    top: nameOf(top) || DEFAULT_TOP,
    bottom: nameOf(bottom) || DEFAULT_BOTTOM,
    initiator: initiating && initiating === bottom && bottom !== top ? 'bottom' : 'top',
  };
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

// --- choreography participants ----------------------------------------------

/** The `bpmn:Definitions` root above a business object, if reachable. */
function definitionsOf(bo: ModdleObject | undefined): ModdleObject | undefined {
  let current: ModdleObject | undefined = bo;
  const seen = new Set<ModdleObject>();
  while (current && current.$type !== 'bpmn:Definitions' && !seen.has(current)) {
    seen.add(current);
    current = (current as { $parent?: ModdleObject }).$parent;
  }
  return current?.$type === 'bpmn:Definitions' ? current : undefined;
}

/** The moddle factory that minted `target` (`$model`), if any. */
function modelOf(target: ModdleObject | undefined): {
  create?: (type: string, props: object) => ModdleObject;
} | undefined {
  const model = (target as { $model?: unknown } | undefined)?.$model;
  return model && typeof model === 'object'
    ? (model as { create?: (t: string, p: object) => ModdleObject })
    : undefined;
}

/**
 * The element that owns `participants` for a choreography task — its enclosing
 * `bpmn:Choreography` (the studyflow choreography root) or, in a process-rooted
 * document, a `bpmn:Collaboration` among the root elements. One is created (with no
 * DI plane, so its participants live in the XML without drawing) when neither exists.
 */
function participantHolder(bo: ModdleObject, ids: IdGenerator): ModdleObject | undefined {
  let current: ModdleObject | undefined = (bo as { $parent?: ModdleObject }).$parent;
  const seen = new Set<ModdleObject>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (Array.isArray(prop(current, 'participants'))) return current;
    current = (current as { $parent?: ModdleObject }).$parent;
  }

  const definitions = definitionsOf(bo);
  if (!definitions) return undefined;
  const roots = prop(definitions, 'rootElements');
  const list = Array.isArray(roots) ? (roots as ModdleObject[]) : [];
  const existing = list.find((re) => Array.isArray(prop(re, 'participants')));
  if (existing) return existing;

  const created = modelOf(definitions)?.create?.('bpmn:Collaboration', {
    id: ids.nextPrefixed('Collaboration_'),
    participants: [],
  });
  if (!created) return undefined;
  (created as { $parent?: unknown }).$parent = definitions;
  setProp(definitions, 'rootElements', [...list, created]);
  return created;
}

/**
 * The `[top, bottom]` participants of a choreography task, creating either that the
 * document lacks (ported from the modeler's `ensureChoreographyParticipants`, minus
 * its `modeling`/`bpmnFactory` services — everything is mutated in place through
 * moddle). Returns `undefined` when the document offers no moddle factory to mint
 * with, in which case a band edit is skipped rather than silently dropped.
 */
export function ensureChoreographyParticipants(
  node: SceneNode,
  ids: IdGenerator,
): [ModdleObject, ModdleObject] | undefined {
  const bo = node.businessObject;
  const refs = prop(bo, 'participantRef');
  const list = Array.isArray(refs) ? (refs as ModdleObject[]) : [];
  if (list.length >= 2) return [list[0], list[1]];

  const model = modelOf(bo) ?? modelOf(definitionsOf(bo));
  if (!model?.create) return undefined;
  const holder = participantHolder(bo, ids);
  if (!holder) return undefined;

  const make = (name: string): ModdleObject => model.create!('bpmn:Participant', {
    id: ids.nextPrefixed('Participant_'),
    name,
  });
  const top = list[0] ?? make(DEFAULT_TOP);
  const bottom = list[1] ?? make(DEFAULT_BOTTOM);
  const fresh = [top, bottom].filter((_p, i) => !list[i]);

  for (const p of fresh) (p as { $parent?: unknown }).$parent = holder;
  const held = prop(holder, 'participants');
  setProp(holder, 'participants', [...(Array.isArray(held) ? held : []), ...fresh]);
  setProp(bo, 'participantRef', [top, bottom]);
  setProp(bo, 'initiatingParticipantRef', prop(bo, 'initiatingParticipantRef') ?? top);
  return [top, bottom];
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

  private session?: LabelEditingSession;
  private input?: HTMLTextAreaElement;
  /** Guards the blur→complete path while the overlay is being torn down. */
  private closing = false;
  /** Lazily seeded from the live document, for minting participant/collaboration ids. */
  private ids?: IdGenerator;

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

  /** Drop the id generator's document seed (called on a fresh import). */
  reset(): void {
    this.cancel();
    this.ids = undefined;
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

    // A band's text belongs to the participant, not the choreography task.
    const refs = prop(element.businessObject, 'participantRef');
    const hadPair = Array.isArray(refs) && refs.length >= 2;
    const participants = ensureChoreographyParticipants(element, this.idGenerator(element));
    if (!participants) return [];
    const target = session.band === 'top' ? participants[0] : participants[1];
    const affected = this.tasksReferencing(target, element);
    const named = writeback.setName(affected, text, target);
    // Minting the participant pair is itself a document edit, even when the typed
    // text matches the placeholder name it was seeded with.
    if (!named && !hadPair) writeback.touch(element);
    return named || !hadPair ? affected : [];
  }

  /**
   * Every choreography task in the scene that references `participant`, with `first`
   * at the head. One participant is shared across the tasks it takes part in, so a
   * rename changes a band on each of them.
   */
  private tasksReferencing(participant: ModdleObject, first: SceneNode): SceneElement[] {
    const out: SceneElement[] = [first];
    const scene = this.getScene();
    if (!scene) return out;
    for (const element of scene.elementsById.values()) {
      if (element.kind !== 'node' || element === first) continue;
      if (!isChoreographyTask(element)) continue;
      const refs = prop(element.businessObject, 'participantRef');
      if (Array.isArray(refs) && refs.includes(participant)) out.push(element);
    }
    return out;
  }

  /** The document-seeded id source (built once per import). */
  private idGenerator(node: SceneNode): IdGenerator {
    if (!this.ids) this.ids = IdGenerator.fromDefinitions(definitionsOf(node.businessObject));
    return this.ids;
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
      return;
    }
    // Enter commits; Shift+Enter (or Ctrl/Meta+Enter) inserts a line break.
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      ev.stopPropagation();
      this.complete();
    }
  }
}
