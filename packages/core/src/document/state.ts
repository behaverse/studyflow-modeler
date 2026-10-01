import { getProperty, setProperty, type Moddle, type ModdleElement } from '@core/document/moddle';
import { STUDY_EXTENSION_TYPE, primaryRoot, studyExtensionOf } from '@core/document/format';
import type { StateTree } from '@core/model/state';

/**
 * The retrospective `state` tree (docs/developers.qmd, "What a run leaves behind"): keyed by element id, stored as a JSON string on
 * the `studyflow:Study` extension, lifted to the top-level `state:` mapping of a `.studyflow` file.
 */

/** The `studyflow:Study` extension of the primary root, created (with its `extensionElements`) when missing. */
function ensureStudyExtension(definitions: ModdleElement, moddle: Moddle): ModdleElement | undefined {
  const existing = studyExtensionOf(definitions);
  if (existing) return existing;
  const root: any = primaryRoot(definitions);
  if (!root) return undefined;
  const holder = extensionElementsOf(root, moddle);
  const study = moddle.create(STUDY_EXTENSION_TYPE, {});
  study.$parent = holder;
  holder.get('values').push(study);
  return study;
}

/** `element`'s `bpmn:ExtensionElements`, created when missing. */
function extensionElementsOf(element: any, moddle: Moddle): any {
  let holder = element.extensionElements;
  if (!holder) {
    holder = moddle.create('bpmn:ExtensionElements', { values: [] });
    holder.$parent = element;
    element.set('extensionElements', holder);
  }
  return holder;
}

/** The parsed tree; `{}` when absent or not a JSON object. */
export function readState(definitions: ModdleElement | null | undefined): StateTree {
  return stateOn(studyExtensionOf(definitions));
}

function stateOn(study: ModdleElement | undefined): StateTree {
  const raw = getProperty(study, 'state');
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** JSON-encodes `tree` onto the Study extension (created when missing); an empty tree removes the property. */
export function writeState(definitions: ModdleElement, moddle: Moddle, tree: StateTree | null | undefined): void {
  const empty = !tree || Object.keys(tree).length === 0;
  const study = empty ? studyExtensionOf(definitions) : ensureStudyExtension(definitions, moddle);
  if (!study) return;
  setProperty(study, 'state', empty ? undefined : JSON.stringify(tree));
}
