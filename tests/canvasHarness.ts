/**
 * The preamble every canvas unit spec used to re-declare.
 *
 * A canvas spec needs the same four things before it can assert anything: the
 * shipped schemas compiled into a `TypeCatalog` and into `bpmn-moddle` packages, a
 * FRESH moddle instance per fixture (moddle mutates the packages it is handed), a
 * DOM for the canvas to mint SVG into (`setDocument` — the canvas ships no
 * rendering dependency), and a pointer shim, because a `Canvas` listens for real
 * `pointerdown`/`pointermove`/`pointerup` events in *screen* coordinates while a
 * test only knows *diagram* coordinates.
 *
 * All four live here once. A spec that needs no DOM (`canvas-import`) imports
 * {@link freshModdle} alone; one that drives the editor calls {@link loadCanvas},
 * which installs the document for it.
 *
 * Keep this file free of assertions and fixtures: XML fixtures belong to the spec
 * that reads them, so a fixture change can never silently move another suite.
 */

import { BpmnModdle } from 'bpmn-moddle';
import { JSDOM } from 'jsdom';

import { buildCatalog, setCatalog } from '@core/notation';
import { toModdlePackages } from '@core/notation/schemaFile';
import { Canvas, setDocument } from '@canvas/index.ts';
import type { CanvasOptions } from '@canvas/index.ts';
import { loadSchemaModels } from './schemas';

const models = loadSchemaModels();
setCatalog(buildCatalog(models));

/** `bpmn-moddle` package descriptors, one per shipped schema, keyed by prefix. */
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

/**
 * A moddle instance nothing else has parsed with. The packages are cloned per
 * instance because moddle annotates the descriptors it is given, and a shared
 * instance would leak `$parent` links between fixtures.
 */
export function freshModdle(): any {
  return new BpmnModdle(structuredClone(packages)) as any;
}

let jsdom: JSDOM | undefined;

/**
 * The jsdom `Document` the canvas mints SVG nodes into, installed globally through
 * `setDocument`. Idempotent: one document backs every spec in a worker (the canvas
 * only ever uses it as a node factory), and calling it again re-points the global
 * at that document, so a spec that installs its own DOM cannot strand a later one.
 */
export function installDocument(): Document {
  jsdom ??= new JSDOM('<!doctype html><html><body></body></html>');
  const doc = jsdom.window.document as unknown as Document;
  setDocument(doc);
  return doc;
}

/** A parsed fixture and the canvas that imported it — the shape every spec used. */
export interface Loaded {
  canvas: Canvas;
  /** The live `bpmn:Definitions` tree the canvas edits in place. */
  definitions: any;
  /** The moddle instance it was parsed with — reuse it to serialize the tree back. */
  moddle: any;
}

/** Parse `xml` and import it into a fresh {@link Canvas}. */
export async function loadCanvas(xml: string, options: CanvasOptions = {}): Promise<Loaded> {
  installDocument();
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(xml);
  const canvas = new Canvas(options);
  canvas.importDefinitions(definitions);
  return { canvas, definitions, moddle };
}

/** A point in DIAGRAM coordinates — what a spec reads off the scene or the DI. */
export interface Pt {
  x: number;
  y: number;
}

/** Dispatch one mouse event at a diagram point, converted to screen coordinates. */
function firePointer(
  canvas: Canvas,
  target: EventTarget,
  type: string,
  at: Pt,
  init: MouseEventInit = {},
): void {
  const screen = canvas.getViewport().toScreen(at);
  const view = canvas.getSvg().ownerDocument!.defaultView!;
  target.dispatchEvent(new view.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: screen.x,
    clientY: screen.y,
    button: 0,
    ...init,
  }));
}

/** Press on the canvas SVG at a diagram point (the gesture always starts there). */
export function pointerDown(canvas: Canvas, at: Pt, init: MouseEventInit = {}): void {
  firePointer(canvas, canvas.getSvg(), 'pointerdown', at, init);
}

/** Move, on the DOCUMENT — a drag keeps tracking once the pointer leaves the SVG. */
export function pointerMove(canvas: Canvas, at: Pt, init: MouseEventInit = {}): void {
  firePointer(canvas, canvas.getSvg().ownerDocument!, 'pointermove', at, init);
}

/** Release, on the document, for the same reason as {@link pointerMove}. */
export function pointerUp(canvas: Canvas, at: Pt, init: MouseEventInit = {}): void {
  firePointer(canvas, canvas.getSvg().ownerDocument!, 'pointerup', at, init);
}

/**
 * The window that owns {@link installDocument}'s document. Needed wherever a spec
 * mints an event class of its own (`dblclick`, `input`, `blur`): jsdom's listeners
 * only recognize events built by their own window, never Node's globals.
 */
export function jsdomWindow(): Window & typeof globalThis {
  return installDocument().defaultView!;
}

/**
 * A `KeyboardEvent` built by the jsdom window. Node's global `KeyboardEvent` is a
 * different class from the one jsdom's listeners see, so a spec must mint keystrokes
 * through the window that owns the document.
 */
export function keyEvent(type: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const view = installDocument().defaultView!;
  return new view.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
}

/** A full press–move–release gesture between two diagram points. */
export function dragBy(canvas: Canvas, from: Pt, to: Pt): void {
  pointerDown(canvas, from);
  pointerMove(canvas, to);
  pointerUp(canvas, to);
}

/** A press with no movement — selects whatever is under the point. */
export function click(canvas: Canvas, at: Pt): void {
  pointerDown(canvas, at);
  pointerUp(canvas, at);
}
