/** The sub-process breadcrumb trail, derived from the canvas's drill-down scope. Navigation writes nothing. */

import type { EditorElement, Editor } from '@modeler/editor/port';

export interface Crumb {
  id: string;
  label: string;
  root: EditorElement;
  isCurrent: boolean;
}

export function crumbLabel(root: EditorElement): string {
  const name = root?.businessObject?.name;
  if (typeof name === 'string' && name.trim()) return name;
  const id = root?.businessObject?.id ?? root?.id;
  return typeof id === 'string' && id ? id : '';
}

/** Root → current scope; empty at the document root, where one crumb is not a trail. */
export function planeCrumbs(editor: Editor): Crumb[] {
  const path: EditorElement[] = editor.canvas.scopePath();
  if (path.length < 2) return [];
  return path.map((root, index) => ({
    id: String(root?.id ?? index),
    label: crumbLabel(root),
    root,
    isCurrent: index === path.length - 1,
  }));
}

export function goToCrumb(editor: Editor, crumb: Crumb): void {
  if (crumb.isCurrent) return;
  editor.canvas.goToScope(crumb.root);
}
