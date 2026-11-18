import { useEffect, useState } from 'react';
import { planChecks, type Issue } from '@core/checks';
import type { Editor } from '@modeler/editor/port';

/** The ids selected on the canvas, as they change. */
export function useSelection(editor: Editor): readonly string[] {
  const [ids, setIds] = useState<readonly string[]>(() => editor.canvas.selection);
  useEffect(() => {
    const onChanged = (e: { newSelection?: readonly string[] }) => setIds(e.newSelection ?? []);
    editor.events.on('SelectionChanged', onChanged);
    return () => editor.events.off('SelectionChanged', onChanged);
  }, [editor]);
  return ids;
}

/** A study is blank while it holds no shape but the start event a new study opens with, and no flow. */
const isBlank = (editor: Editor): boolean =>
  editor.study.list({ kind: 'node' }).length <= 1 && editor.study.list({ kind: 'edge' }).length === 0;

export function useIsBlank(editor: Editor): boolean {
  const [blank, setBlank] = useState(() => isBlank(editor));
  useEffect(() => {
    const sync = () => setBlank(isBlank(editor));
    sync();
    return editor.study.on('change', sync);
  }, [editor]);
  return blank;
}

/** How long the study has to rest before its checks run again: they read the whole plan. */
const SETTLE_MS = 500;

/** What `studyflow validate` would say of the plan as it stands (core's `planChecks`). A study mid-edit can be one no
 * check expected; it reads as no problems rather than as a broken app. */
export function problemsOf(editor: Editor): Issue[] {
  try {
    return planChecks(editor.study.model);
  } catch {
    return [];
  }
}

/** The plan's problems, read again once an edit settles. */
export function useProblems(editor: Editor): Issue[] {
  const [issues, setIssues] = useState<Issue[]>([]);
  useEffect(() => {
    let timer: number | undefined;
    const check = () => setIssues(problemsOf(editor));
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, SETTLE_MS);
    };
    check();
    const stop = editor.study.on('change', schedule);
    return () => { stop(); window.clearTimeout(timer); };
  }, [editor]);
  return issues;
}
