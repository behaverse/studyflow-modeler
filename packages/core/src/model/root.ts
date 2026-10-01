/**
 * The study is the root, whichever kind it is: a process, or the collaboration its pools are drawn in. When the root
 * changes kind (the first pool drawn, the last one deleted), the study passes from one to the other.
 */
import { isElement, type Element, type StudyModel, type Value } from '@core/model/index';
import { foldTyped } from '@core/model/yaml';

const STUDY = 'studyflow:Study';

/** What a root keeps when the study passes on: its id (swapped instead), its content, and its entries but the Study. */
const KEPT_BY_ROOT = new Set(['id', 'artifacts', 'extensionElements']);

/** Give elements other ids: each id `renames` maps, and every reference to it, and its drawing. */
export function renameIds(model: StudyModel, renames: ReadonlyMap<string, string>): void {
  const renamed = (value: Value): Value => (typeof value === 'string' && renames.has(value) ? renames.get(value)! : value);
  const elements = [...model.all()];
  for (const element of elements) {
    for (const [key, value] of Object.entries(element)) {
      if (key === 'type' || key === 'id' || value === undefined || !model.propertyAt(element, key)?.isReference) continue;
      element[key] = Array.isArray(value) ? value.map(renamed) : renamed(value);
    }
  }
  for (const element of elements) if (typeof element.id === 'string' && renames.has(element.id)) element.id = renames.get(element.id);
  model.study.layout = Object.fromEntries(Object.entries(model.study.layout).map(([id, drawing]) => [renames.get(id) ?? id, drawing]));
  model.reindex();
}

/** Take `element`'s Study off it: the Study it is typed as, or the entry it carries. */
function takeStudy(model: StudyModel, element: Element): Element | undefined {
  if (element.type === STUDY) {
    const study = model.typedEntry(element)!;
    for (const key of Object.keys(study)) if (key !== 'type') delete element[key];
    element.type = model.host(element);
    return study;
  }
  const entries = Array.isArray(element.extensionElements) ? element.extensionElements : [];
  const study = entries.find((entry): entry is Element => isElement(entry) && entry.type === STUDY);
  if (!study) return undefined;
  const rest = entries.filter((entry) => entry !== study);
  if (rest.length > 0) element.extensionElements = rest;
  else delete element.extensionElements;
  return study;
}

/** Put `study` on `element`: as its entry, folded into the element (typed so) where the Study attaches to its kind (a process). */
function giveStudy(model: StudyModel, element: Element, study: Element): void {
  element.extensionElements = [...(Array.isArray(element.extensionElements) ? element.extensionElements : []), study];
  const folded = foldTyped(model.metamodel, element);
  if (folded === element) return;
  for (const key of Object.keys(element)) delete element[key];
  Object.assign(element, folded);
}

/**
 * `to` takes the study over from `from`: its id, the properties both kinds declare (name, documentation) and the
 * Study; `from` takes `freshId`. The process's entry in the run state follows the process's id, since its properties
 * are what the entry holds.
 */
export function handOverStudyIn(model: StudyModel, from: Element, to: Element, freshId: string): void {
  const process = model.host(from) === 'bpmn:Process' ? from : to;
  const scope = process.id;
  const id = from.id;
  if (id) renameIds(model, new Map([[id, freshId], ...(to.id ? [[to.id, id] as [string, string]] : [])]));
  to.id = id ?? freshId;

  const shared = model.metamodel.descriptor(model.host(to)).propertiesByName;
  for (const { name } of model.metamodel.descriptor(model.host(from)).properties) {
    if (KEPT_BY_ROOT.has(name) || !shared[name] || from[name] === undefined) continue;
    to[name] = from[name];
    delete from[name];
  }
  const study = takeStudy(model, from);
  if (study) giveStudy(model, to, study);

  const state = model.study.state;
  if (state && scope && process.id && scope !== process.id && scope in state) {
    model.study.state = Object.fromEntries(Object.entries(state).map(([key, value]) => [key === scope ? process.id! : key, value]));
  }
  model.reindex();
}
