/** The sub-process breadcrumb trail, derived from the canvas's drill-down scope. Navigation writes nothing. */

import type { Editor } from '@modeler/editor/port';

export interface Crumb {
  id: string;
  label: string;
  isCurrent: boolean;
}

/** Root → current scope; empty at the document root, where one crumb is not a trail. */
export function planeCrumbs(editor: Editor): Crumb[] {
  const path = editor.canvas.scopePath;
  if (path.length < 2) return [];
  return path.map((id, index) => ({
    id,
    label: editor.study.get(id)?.name?.trim() || id,
    isCurrent: index === path.length - 1,
  }));
}

export function goToCrumb(editor: Editor, crumb: Crumb): void {
  if (crumb.isCurrent) return;
  editor.canvas.setScope(crumb.id === editor.study.root.id ? undefined : crumb.id);
}
