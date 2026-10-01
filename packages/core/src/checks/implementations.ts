import type { Issue } from '@core/checks';
import type { StudyModel } from '@core/model/index';

/**
 * Every `implementation` a study names is a `<scheme>://<ref>` some skill runs: a skill declares its schemes in its
 * `SKILL.md` (`metadata.schemes`). One no loaded skill declares is reported before a run, as a warning, since
 * another machine may have the skill that runs it.
 */
export function checkImplementations(model: StudyModel, schemes: ReadonlySet<string>): Issue[] {
  const issues: Issue[] = [];
  for (const element of model.all()) {
    const value = element.implementation;
    if (typeof value !== 'string' || !model.propertyAt(element, 'implementation')) continue;
    const id = model.ownerOf(element);
    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value)?.[1]?.toLowerCase();
    if (!scheme) {
      issues.push({ severity: 'warning', elementId: id, message: `${JSON.stringify(id)} names ${JSON.stringify(value)}, which is no <scheme>://<ref> a runner can claim` });
    } else if (!schemes.has(scheme)) {
      issues.push({ severity: 'warning', elementId: id, message: `${JSON.stringify(id)} names ${scheme}://, which no loaded skill runs (${[...schemes].sort().join(', ')})` });
    }
  }
  return issues;
}
