/**
 * Sub-process drill-down — the pure half (drill-down spec, plan §3.5).
 *
 * Deriving the breadcrumb trail is a table lookup over `view.planePath()`, so it
 * lives here, unit-testable, and `drilldown/Breadcrumbs.tsx` only renders it.
 *
 * These are plain helpers, NOT `run*` command handlers: navigation writes nothing,
 * records no undo step and has nothing to serialize, so putting it on the command
 * bus would buy a history entry for a scroll (plan §5-D7). The breadcrumb calls
 * `view.goToPlane` through the port directly.
 */

import type { EditorElement, EditorPort } from '@modeler/editor/port';

/** One step of the breadcrumb trail. */
export interface Crumb {
  /** The plane root's id — the process/sub-process id, unique within the trail. */
  id: string;
  /** What the crumb reads: the element's name, or its id when it has none. */
  label: string;
  /** The plane root to hand back to `view.goToPlane`. */
  root: EditorElement;
  /** The plane on screen: the last crumb, which navigates nowhere. */
  isCurrent: boolean;
}

/** What a crumb reads: the plane element's name, falling back to its id. */
export function crumbLabel(root: EditorElement): string {
  const name = root?.businessObject?.name;
  if (typeof name === 'string' && name.trim()) return name;
  const id = root?.businessObject?.id ?? root?.id;
  return typeof id === 'string' && id ? id : '';
}

/**
 * Root → current plane. Empty at the document root: one crumb is not a trail, and
 * the reference hides the bar entirely there (`edge-videos/sub/frame_00` shows no
 * breadcrumb).
 */
export function planeCrumbs(editor: EditorPort): Crumb[] {
  const path: EditorElement[] = editor.view.planePath();
  if (path.length < 2) return [];
  return path.map((root, index) => ({
    id: String(root?.id ?? index),
    label: crumbLabel(root),
    root,
    isCurrent: index === path.length - 1,
  }));
}

/** Navigate to `crumb`'s plane; the current one is a no-op. */
export function goToCrumb(editor: EditorPort, crumb: Crumb): void {
  if (crumb.isCurrent) return;
  editor.view.goToPlane(crumb.root);
}
