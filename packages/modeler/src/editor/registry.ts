/**
 * The editor handle and the `EditorPort` lookup.
 *
 * The app never holds an editor implementation — it holds a {@link PortHandle}
 * whose one app-visible member is the {@link EditorPort} facade.
 * `editor/canvasBackend.ts` builds the handle and the app carries it on
 * `ModelerContext` from there on.
 *
 * The lookup is the identity on `handle.editor` — kept as a function so command
 * handlers keep one shape to talk to, and so a lazily-built facade could be
 * introduced without touching every call site.
 */

import type { EditorPort } from '@modeler/editor/port';

/**
 * What the app passes around in place of an editor: an opaque handle whose
 * `editor` is the facade. The editor may attach its own internals to it; app-side
 * code must not read them.
 */
export interface PortHandle {
  readonly editor: EditorPort;
  destroy(): void;
}

/** The `EditorPort` for `handle`. */
export function getEditorPort(handle: PortHandle): EditorPort {
  return handle.editor;
}
