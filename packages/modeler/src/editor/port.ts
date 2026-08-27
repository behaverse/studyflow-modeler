/**
 * The app's door onto the editor facade.
 *
 * The `Editor` interface itself is declared once, in `@canvas/port/editor.ts`, and
 * re-exported here: app-side code keeps importing `@modeler/editor/port` and never
 * names the canvas package, while the implementation and the interface it satisfies
 * stay in one file instead of two copies checked against each other at an assignment
 * site. (The dependency only ever ran one way — the canvas is a leaf and must not
 * import `@modeler/*`; the modeler imports `@canvas/*` in the backend, the palette
 * and the simulator already.)
 *
 * `editor/editor.ts` assembles the one instance and `editor/mount.ts` builds the
 * canvas under it; the app carries it on `ModelerContext` from there on.
 */

export type {
  Editor,
  EditorElement,
  EditorElements,
  EditorEventListener,
  /** What `editor/history.ts` must satisfy to be the editor's undo. */
  EditorHistory,
  EditorModel,
  EditorMutations,
  EditorRules,
  EditorSimulation,
  EditorTemplates,
  EditorView,
  ModelElement,
  Moddle,
  Rect,
  Viewbox,
  /**
   * The canvas services the facade publishes AS ITS OWN members — `Editor.canvas`,
   * `Editor.selection`, `Editor.events`. Re-exported so app-side code that names one
   * of their types still imports from this one door.
   */
  Canvas,
  EventBus,
  Selection,
} from '@canvas/port/editor.ts';

import type { EditorElement, ModelElement } from '@canvas/port/editor.ts';

/**
 * `is` from `bpmn-js/lib/util/ModelUtil`, reimplemented verbatim so app-side
 * files need no direct bpmn-js import.
 */
export function is(element: EditorElement | ModelElement, type: string): boolean {
  const bo = getBusinessObject(element);
  return !!bo && typeof bo.$instanceOf === 'function' && bo.$instanceOf(type);
}

/** `getBusinessObject` from `bpmn-js/lib/util/ModelUtil`, reimplemented verbatim. */
export function getBusinessObject(element: EditorElement): ModelElement {
  return (element && element.businessObject) || element;
}
