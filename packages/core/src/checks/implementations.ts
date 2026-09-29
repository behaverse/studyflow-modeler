import type { ModdleElement } from '@core/element/moddle';
import type { Issue } from '@core/checks';

/**
 * Every `implementation` a study names is a `<scheme>://<ref>` some skill runs: a skill declares its schemes in its
 * `SKILL.md` (`metadata.schemes`). One no loaded skill declares is reported before a run, as a warning, since
 * another machine may have the skill that runs it.
 */
export function checkImplementations(definitions: ModdleElement, schemes: ReadonlySet<string>): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<unknown>();
  const visit = (element: ModdleElement, owner?: string): void => {
    if (!element || typeof element !== 'object' || seen.has(element)) return;
    seen.add(element);
    const id = typeof element.id === 'string' ? element.id : owner;
    for (const property of element.$descriptor?.properties ?? []) {
      const value = element[property.name];
      if (property.ns?.localName === 'implementation' && typeof value === 'string') {
        const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value)?.[1]?.toLowerCase();
        if (!scheme) {
          issues.push({ severity: 'warning', elementId: id, message: `${JSON.stringify(id)} names ${JSON.stringify(value)}, which is no <scheme>://<ref> a runner can claim` });
        } else if (!schemes.has(scheme)) {
          issues.push({ severity: 'warning', elementId: id, message: `${JSON.stringify(id)} names ${scheme}://, which no loaded skill runs (${[...schemes].sort().join(', ')})` });
        }
        continue;
      }
      if (property.isReference) continue;
      if (Array.isArray(value)) value.forEach((item) => visit(item, id));
      else if (value && typeof value === 'object' && '$type' in value) visit(value, id);
    }
  };
  visit(definitions);
  return issues;
}
