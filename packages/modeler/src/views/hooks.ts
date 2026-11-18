import { useEffect, useReducer } from 'react';
import { executeCommand } from '@modeler/commandBus';
import type { Editor } from '@modeler/editor/port';

/** A number that changes with every edit of the study: what a view reads its rows again on. */
export function useStudyVersion(editor: Editor): number {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => editor.study.on('change', bump), [editor]);
  return version;
}

/** A view's row pressed: its element selected on the canvas, and shown there. */
export function showElement(editor: Editor, id: string): void {
  void executeCommand(editor, { type: 'GoToElement', id });
}
