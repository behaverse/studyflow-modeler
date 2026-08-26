/**
 * Which editor backend the app mounts.
 *
 * P6a keeps bpmn-js the default; the native canvas rides behind a flag so both can
 * be exercised by the same suites. Resolution order (first match wins):
 *
 * 1. `?editor=canvas` / `?editor=bpmn` on the page URL — runtime, per tab, which is
 *    what e2e drives;
 * 2. `localStorage['studyflow.editorBackend']` — sticky across reloads within a tab
 *    that has no query param (e2e sets it before the app boots, for flows that
 *    navigate);
 * 3. `STUDYFLOW_EDITOR_BACKEND` in the environment the dev server / build ran in,
 *    baked in by `vite.config.ts`;
 * 4. `'bpmn'`.
 *
 * Anything unrecognised falls through to the next source, so a typo cannot silently
 * boot the wrong editor.
 */

import type { EditorBackend } from '@modeler/editor/registry';

export const EDITOR_BACKEND_PARAM = 'editor';
export const EDITOR_BACKEND_STORAGE_KEY = 'studyflow.editorBackend';
export const DEFAULT_EDITOR_BACKEND: EditorBackend = 'bpmn';

function parse(value: string | null | undefined): EditorBackend | undefined {
  const name = value?.trim().toLowerCase();
  return name === 'canvas' || name === 'bpmn' ? name : undefined;
}

function fromQuery(): EditorBackend | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return parse(new URL(window.location.href).searchParams.get(EDITOR_BACKEND_PARAM));
  } catch {
    return undefined;
  }
}

function fromStorage(): EditorBackend | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return parse(window.localStorage.getItem(EDITOR_BACKEND_STORAGE_KEY));
  } catch {
    // Private mode / storage disabled: the flag simply is not set.
    return undefined;
  }
}

/**
 * Baked in by `vite.config.ts` from `process.env.STUDYFLOW_EDITOR_BACKEND`. Read
 * through `typeof` so the identifier is also safe where nothing defined it — the
 * browserless unit lane compiles this file without Vite's substitution.
 */
declare const __STUDYFLOW_EDITOR_BACKEND__: string | undefined;

function fromEnvironment(): EditorBackend | undefined {
  return parse(typeof __STUDYFLOW_EDITOR_BACKEND__ === 'string' ? __STUDYFLOW_EDITOR_BACKEND__ : undefined);
}

/** The backend this page should mount. */
export function resolveEditorBackend(): EditorBackend {
  return fromQuery() ?? fromStorage() ?? fromEnvironment() ?? DEFAULT_EDITOR_BACKEND;
}
