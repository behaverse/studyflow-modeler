import { STUDY_EXTENSION_TYPE } from '@core/document/format';
import { isElement, type Element, type StudyModel, type Value } from '@core/model/index';
import type { StateTree } from '@core/model/state';

/**
 * The retrospective `state` tree (docs/developers.qmd, "What a run leaves behind"): keyed by element id, stored as a JSON string on
 * the `studyflow:Study` extension, lifted to the top-level `state:` mapping of a `.studyflow` file.
 */

/** The tree a Study's `state` text holds; `{}` when absent or not a JSON object. */
function parsed(raw: unknown): StateTree {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const tree = JSON.parse(raw);
    return tree && typeof tree === 'object' && !Array.isArray(tree) ? tree : {};
  } catch {
    return {};
  }
}

/** The run state of a study read from BPMN XML, lifted off its Study to the study's own: the primary root's tree,
 * and no Study's text. */
export function liftState(model: StudyModel): void {
  const tree = parsed(model.studyOf(model.primaryRoot())?.state);
  for (const element of model.all()) if (element.type === STUDY_EXTENSION_TYPE) delete element.state;
  if (Object.keys(tree).length > 0) model.study.state = tree;
}

/** The run state of a study written as BPMN XML, as {@link liftState} lifts it: the study's own, a JSON text on its
 * primary root's Study, one put last among the root's extension elements when it has none. */
export function lowerState(model: StudyModel): void {
  const tree = model.study.state;
  const root = model.primaryRoot();
  if (!tree || Object.keys(tree).length === 0 || !root) return;
  const entries = root.type === STUDY_EXTENSION_TYPE ? [root] : extensionsOf(root);
  let study = entries.find((entry): entry is Element => isElement(entry) && entry.type === STUDY_EXTENSION_TYPE);
  if (!study) entries.push(study = { type: STUDY_EXTENSION_TYPE });
  study.state = JSON.stringify(tree);
}

/** The list of `element`'s extension elements (its holder's, when it has one), made when it has none. */
function extensionsOf(element: Element): Value[] {
  const holder = isElement(element.extensionElements) ? element.extensionElements : element;
  const key = holder === element ? 'extensionElements' : 'values';
  if (!Array.isArray(holder[key])) holder[key] = [];
  return holder[key] as Value[];
}
