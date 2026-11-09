import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { quoted } from '@core/checks/graph';
import { isElement, type Element, type StudyModel } from '@core/model/index';
import { isReservedStateKey } from '@core/model/state';

/**
 * The data stores, the values a study keeps for all its participants: each cited by a name no other store has and
 * the runner does not reserve, and none hidden from a process by a property of the same name.
 */
export function checkStores(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  const named = new Map<string, Element>();
  for (const store of model.study.roots.filter((root) => model.host(root) === BPMN.DataStore)) {
    const name = String(store.name || store.id);
    const other = named.get(name);
    if (isReservedStateKey(name)) {
      issues.push({ severity: 'error', elementId: store.id, message: `data store ${quoted(store)}: a name starting with _ is the runner's` });
    } else if (other) {
      issues.push({ severity: 'error', elementId: store.id, message: `data stores "${other.id}" and "${store.id}" are both named '${name}', which then cites only one` });
    } else {
      named.set(name, store);
    }
  }
  for (const process of model.study.roots.filter((root) => model.host(root) === BPMN.Process)) {
    for (const property of (Array.isArray(process.properties) ? process.properties : []).filter(isElement)) {
      const store = named.get(String(property.name || property.id));
      if (store) {
        issues.push({ severity: 'warning', elementId: process.id, message: `${quoted(process)} declares a property named '${property.name || property.id}', which hides data store "${store.id}" inside it: rename one` });
      }
    }
  }
  return issues;
}
