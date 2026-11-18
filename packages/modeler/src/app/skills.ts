/**
 * Skills turned on while the modeler runs: the schemas loaded again with them, which replaces the catalog, and the study
 * read again on the new metamodel by the app's editor (`Modeler.tsx` listens). Turning a skill off waits for a reload:
 * the study read again without it would drop its elements.
 */

import { useSyncExternalStore } from 'react';
import { metamodelOf } from '@core/model/packages';
import type { Metamodel } from '@core/model/metamodel';
import { getCatalog, hasCatalog } from '@core/notation';
import { loadSchemas, SCHEMA_NAMES } from '@core/notation/loader';
import { fetchInstalledSchemas } from '@modeler/app/installedSchemas';
import { getSettings, setSettings } from '@modeler/settings/store';
import type { Editor } from '@modeler/editor/port';

/** Reads the study again on `metamodel`, in a new editor, which it returns. */
type Reopen = (metamodel: Metamodel) => Promise<Editor | undefined>;

let version = 0;
const listeners = new Set<() => void>();
let reopen: Reopen | undefined;

/** The app's editor, which reads its study again on a new metamodel. */
export function onSkillsChanged(handler: Reopen): () => void {
  reopen = handler;
  return () => { if (reopen === handler) reopen = undefined; };
}

/** Changes each time the catalog is replaced: what a list of the catalog's types reads again on. */
export function useCatalogVersion(): number {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => version,
    () => version,
  );
}

/** The prefixes of the schemas loaded now. */
export function loadedSchemas(): string[] {
  return hasCatalog() ? getCatalog().schemas.map((schema) => schema.prefix) : [];
}

/** The shipped schemas the Settings leave on: what the boot loads. */
export function enabledSchemas(): string[] {
  const { disabledSchemas } = getSettings();
  return SCHEMA_NAMES.filter((prefix) => !disabledSchemas.includes(prefix));
}

/**
 * Turn the schemas `prefixes` on: kept in the Settings, loaded now, and the study read again with them. Returns the
 * editor that now holds the study when that is a new one.
 */
export async function turnOnSchemas(prefixes: readonly string[]): Promise<Editor | undefined> {
  setSettings({ disabledSchemas: getSettings().disabledSchemas.filter((prefix) => !prefixes.includes(prefix)) });
  const loaded = loadedSchemas();
  if (prefixes.every((prefix) => loaded.includes(prefix))) return undefined;
  // What is loaded stays loaded: a schema turned off since the boot leaves at the next reload, not now.
  const wanted = SCHEMA_NAMES.filter((prefix) => loaded.includes(prefix) || enabledSchemas().includes(prefix));
  const metamodel = metamodelOf(await loadSchemas(wanted, await fetchInstalledSchemas()));
  version += 1;
  listeners.forEach((listener) => listener());
  return reopen?.(metamodel);
}
