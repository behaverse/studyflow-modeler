/**
 * The run state a study carries (`state:`, docs/reference.qmd, "Run state"), and the `{name}` placeholders a view
 * resolves against it: keyed by element id, a container's entry read by everything inside it.
 */
import type { StudyModel } from '@core/model/index';

/** The run state: what each element's entry holds, by its id, and the runner's own under {@link META_KEY}. */
export type StateTree = Record<string, any>;

/** The one runner-owned key: `state._meta.prov` (run records) and `state._meta.<quantity>.<element_id>` (e.g. `reached`). */
export const META_KEY = '_meta';

/** Keys starting with `_` are the runner's own; authors cannot declare properties with such names. */
export function isReservedStateKey(name: string): boolean {
  return name.startsWith('_');
}

/**
 * A placeholder, `{name}` or `{name.field}`, the one form every reader takes (docs/reference.qmd, "Placeholders"):
 * a letter of any script or `_`, then letters, digits, `_`, `-` and dots, so the braces of YAML or JSON in a value
 * stay put. The Python runners spell it `[^\W\d][\w.-]*`, which matches the same names wherever the two engines'
 * Unicode tables agree.
 */
export const PLACEHOLDER = /\{\s*([\p{L}\p{Nl}\p{No}_][\p{L}\p{N}_.-]*)\s*\}/gu;

/** The runner counter a lone name may cite: how often a token reached the element citing it. */
const REACHED = 'reached';

function lookup(node: unknown, keys: string[]): unknown {
  if (keys.length === 0) return undefined;
  let current: any = node;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Lexical lookup of a dotted `path` from `elementId`: the element's own entry, then each container outward to
 * the study root. A lone `{reached}` is the element's own counter, `_meta.reached.<element id>`, and 0 when it has
 * none — a run that never reached it counts 0, and so does a file no run has touched, never a container's count.
 * `state.a.b` is absolute (`state._meta.reached.X` included). `undefined` when nothing resolves.
 */
export function resolveStateIn(model: StudyModel, elementId: string, path: string): unknown {
  const keys = path.split('.').map((key) => key.trim()).filter(Boolean);
  if (keys.length === 0) return undefined;
  const tree: Record<string, any> = model.study.state ?? {};
  if (keys[0] === 'state') return lookup(tree, keys.slice(1));
  for (let scope = model.get(elementId); scope; scope = model.parentOf(scope)) {
    if (typeof scope.id !== 'string') continue;
    const value = lookup(tree, [scope.id, ...keys]);
    if (value !== undefined) return value;
  }
  return keys.length === 1 && keys[0] === REACHED ? tree[META_KEY]?.[REACHED]?.[elementId] ?? 0 : undefined;
}

/** Replaces every `{path}` the last run's state resolves with `String(value)`; an unresolved placeholder stays as written. */
export function resolvePlaceholdersIn(model: StudyModel, text: string, elementId: string): string {
  if (!text.includes('{')) return text;
  return text.replace(PLACEHOLDER, (match, path: string) => {
    const value = resolveStateIn(model, elementId, path);
    return value === undefined ? match : String(value);
  });
}
