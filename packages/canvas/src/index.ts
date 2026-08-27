/**
 * `@behaverse/studyflow-canvas` — the editable SVG canvas the modeler runs on.
 * Vanilla TS + SVG DOM, no rendering dependency.
 *
 * This barrel is the SUPPORTED surface: what a host needs to mount a canvas, hand it
 * a document, and drive it through the editor facade. It is deliberately short.
 *
 * Everything else is reachable, and reaching for it is fine — the package declares
 * `"exports": { "./*": "./src/*" }`, so `@canvas/routing/crop.ts` or
 * `@canvas/interaction/segments.ts` is a first-class import, and that is how the
 * unit specs and the token simulator already read the internals. The distinction the
 * barrel draws is not "public vs private" but "stable vs free to move": a name here
 * is one this package promises to keep, a deep import is one you are reading at your
 * own risk. Re-exporting all ~200 internals, as this file used to, made that promise
 * about every helper in the package and meant deleting a private function was a
 * cross-cutting edit.
 */

// --- the canvas -------------------------------------------------------------
export { Canvas, type CanvasOptions } from './Canvas.ts';

// --- the document it edits --------------------------------------------------
export type {
  Scene,
  Plane,
  SceneElement,
  SceneElementBase,
  SceneElementKind,
  SceneNode,
  SceneEdge,
  SceneLabel,
  ModdleObject,
  Point,
  Bounds,
} from './model/scene.ts';

export { importDefinitions, type ImportOptions } from './model/import.ts';
/** Id minting, which the host shares so app-made elements land in the same space. */
export { IdGenerator, prefixFor } from './model/ids.ts';
/** Whether a type can be collapsed — the palette asks before offering the marker. */
export { isExpandable } from './model/expand.ts';
/** The footprint a palette drop of `type` gets, so host chrome can size a ghost. */
export { defaultSizeFor } from './interaction/create.ts';

// --- the DOM it draws into --------------------------------------------------
/**
 * `setDocument` installs the {@link Document} the canvas mints SVG into — required
 * before constructing a {@link Canvas} outside a browser (a jsdom harness, an
 * export worker). `svgRemove` is here because a host that draws into a custom layer
 * (`Canvas.attachHostLayer`) has to be able to take its own nodes down again.
 */
export { setDocument, ownerDocument, remove as svgRemove } from './render/svg.ts';

/** The chrome stylesheet, for a host that would rather ship it through its own CSS. */
export { injectCanvasStyles, CANVAS_CSS, CANVAS_STYLE_ID } from './view/theme.ts';

/** Glyphs are resolved by the host: {@link CanvasOptions.iconResolver} returns these. */
export type { IconDef, IconResolver } from './render/icons.ts';

// --- the editor facade ------------------------------------------------------
/**
 * The editor facade, declared once in `port/editor.ts` and re-exported to the app
 * through `@modeler/editor/port`. Most of it IS the canvas — `selection`, `events`
 * and `canvas` are the objects above — so the only thing built here is the
 * undoable-mutation half, which needs a commit point the canvas has no way to
 * provide. `@modeler/editor/editor.ts` assembles the two.
 */
export { createMutations, type MutationHistory } from './port/mutations.ts';
export type {
  Editor,
  EditorHistory,
} from './port/editor.ts';
