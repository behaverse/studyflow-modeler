/**
 * Run, the real one: the study in the runner, in a tab of its own. One press for every place that runs it (the
 * composer's button, the palette's command), so a plan with problems asks first wherever Run is pressed: the
 * composer shows the question (`Composer.tsx`), and Run anyway goes on.
 */
import { useSyncExternalStore } from 'react';
import type { Issue } from '@core/checks';
import { openRunnerTab } from '@modeler/app/commands';
import { notify } from '@modeler/app/noticeStore';
import { executeCommand } from '@modeler/commandBus';
import { problemsOf } from '@modeler/composer/hooks';
import type { Editor } from '@modeler/editor/port';

/** The problems Run is asking about, while it asks. */
let question: Issue[] | null = null;
/** A run is being handed to the runner: a second press then opens no second tab. */
let starting = false;
const listeners = new Set<() => void>();

function ask(next: Issue[] | null): void {
  question = next;
  listeners.forEach((listener) => listener());
}

export const dismissRunQuestion = (): void => ask(null);

export function useRunQuestion(): Issue[] | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => question,
    () => question,
  );
}

/** Opens the runner on the study as it stands. Called inside the press, which the runner's tab needs. */
export async function startRun(modeler: Editor): Promise<void> {
  ask(null);
  if (starting) return;
  starting = true;
  // Claimed before the first `await`, while the press still counts as a user gesture.
  const target = openRunnerTab();
  try {
    await executeCommand(modeler, { type: 'OpenRunner', target });
  } catch (err) {
    notify('error', err instanceof Error ? err.message : 'Could not start the runner. Try again, or reload the page.');
  } finally {
    starting = false;
  }
}

/** The question asked again of the plan as it now stands, after a fix made in it. */
export function recheckRunQuestion(modeler: Editor): void {
  if (question) ask(problemsOf(modeler));
}

/** Run pressed: the checks are read now, so an edit a moment ago counts; with problems it asks, else it runs. */
export function pressRun(modeler: Editor): void {
  const issues = problemsOf(modeler);
  if (issues.length > 0) ask(issues);
  else void startRun(modeler);
}
