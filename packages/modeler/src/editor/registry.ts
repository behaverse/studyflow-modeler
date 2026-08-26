/**
 * The editor handle and the `EditorPort` lookup.
 *
 * The app never holds an editor implementation — it holds a {@link PortHandle}
 * whose one app-visible member is the {@link EditorPort} facade. A backend builds
 * the handle (`editor/canvasBackend.ts`) and the app carries it on
 * `ModelerContext` from there on.
 *
 * Before P6b this also accepted a bare didi service resolver, because the bpmn-js
 * context pad dispatched commands with `this.injector` and unit tests stood a
 * modeler in with a `{ get }` object. Both callers died with bpmn-js, so the
 * lookup is now the identity on `handle.editor` — kept as a function so command
 * handlers keep one shape to talk to, and so a future backend can reintroduce a
 * lazily-built facade without touching every call site.
 */

import type { EditorPort } from '@modeler/editor/port';

/**
 * What the app passes around in place of an editor: an opaque handle whose
 * `editor` is the facade. A backend may attach its own internals to it; app-side
 * code must not read them.
 */
export interface PortHandle {
  /** Which implementation built this handle. One backend ships, so one value. */
  readonly backend: 'canvas';
  readonly editor: EditorPort;
  destroy(): void;
}

/** The `EditorPort` for `handle`. */
export function getEditorPort(handle: PortHandle): EditorPort {
  return handle.editor;
}
