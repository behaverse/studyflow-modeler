/**
 * The backend-neutral editor handle and the `EditorPort` lookup.
 *
 * Phase 2 of the bpmn-js migration ("two backends, one facade"): the app no longer
 * holds a bpmn-js `Modeler` — it holds an {@link EditorHandle} whose primary member
 * is the {@link EditorPort}. The raw modeler survives only inside the bpmn backend
 * (`editor/bpmnBackend.ts`) and the editor-internal modules that inject its
 * services (`bpmn/`, `draw/`, `contextPad/`, `templates/`, `simulation/`).
 *
 * `getEditorPort` therefore accepts two shapes:
 *
 * 1. a {@link PortHandle} — what `runCreateModeler` builds and `ModelerContext`
 *    carries, for either backend; the port is read straight off it;
 * 2. a bare service resolver — a didi injector or a bpmn-js modeler. The context
 *    pad dispatches commands with `this.injector` (see `command-bus.unit.spec.ts`),
 *    and unit tests stand a modeler in with a `{ get }` object. Those get a
 *    memoized bpmn adapter, exactly as before.
 */

import { createBpmnEditorPort } from '@modeler/editor/bpmnAdapter';
import type { EditorPort } from '@modeler/editor/port';

/** Which editor implementation is mounted behind the facade. */
export type EditorBackend = 'bpmn' | 'canvas';

/** Anything that resolves editor services by name (a bpmn-js modeler, or its injector). */
export type ServiceResolverLike = { get(...args: any[]): any };

/**
 * What the app passes around in place of the old `Modeler`: an opaque handle whose
 * `editor` is the facade. Backends attach their own internals to it (the bpmn one
 * keeps the modeler on `modeler`); app-side code must not read them.
 */
export interface PortHandle {
  readonly backend: EditorBackend;
  readonly editor: EditorPort;
  /** Backend-private: the bpmn-js modeler, on the bpmn backend only. */
  readonly modeler?: unknown;
  destroy(): void;
}

/** The handle app-side signatures take. */
export type EditorHandle = PortHandle | ServiceResolverLike;

const ports = new WeakMap<object, EditorPort>();

/** Whether `handle` already carries a built facade. */
export function isPortHandle(handle: EditorHandle | null | undefined): handle is PortHandle {
  const editor = (handle as PortHandle | undefined)?.editor;
  return !!editor && typeof editor.revision === 'function';
}

/**
 * The `EditorPort` for `handle`. Handles built by a backend hand theirs over
 * directly; a bare resolver gets a memoized bpmn adapter so every consumer of one
 * resolver shares a single facade.
 */
export function getEditorPort(handle: EditorHandle): EditorPort {
  if (isPortHandle(handle)) return handle.editor;
  const resolver = handle as ServiceResolverLike;
  let port = ports.get(resolver);
  if (!port) {
    port = createBpmnEditorPort(resolver as any);
    ports.set(resolver, port);
  }
  return port;
}
