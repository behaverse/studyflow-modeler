/**
 * The run state a study carries (`state:`, docs/reference.qmd, "Run state"), and the `{name}` placeholders a view
 * resolves against it, or, where no run wrote one, against the value the file declares: keyed by element id, a
 * container's entry read by everything inside it.
 */
import { BPMN } from '@core/constants';
import { literal } from '@core/engine/graph';
import { isElement, type Element, type StudyModel } from '@core/model/index';
import { wiredPropertiesIn } from '@core/model/parameters';

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

/** A placeholder as a view draws it: a {@link PLACEHOLDER}, or one ending in `:%`, which draws a number as a
 * percentage (`{max_unanswered:%}`, 0.2 as 20%). Only the views read the format; a runner leaves it as written. */
const DRAWN = /\{\s*([\p{L}\p{Nl}\p{No}_][\p{L}\p{N}_.-]*)\s*(:%)?\s*\}/gu;

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
 * The value `name` is declared with on `scope`, the state a run starts from: a property's initial `value`, or, on a
 * sub-process, a key of the Parameters wired into it, which the walk reads as a property of it. A Parameters object
 * wired into a task sets the task and declares nothing.
 */
function declaredOn(model: StudyModel, scope: Element, name: string): unknown {
  const property = (Array.isArray(scope.properties) ? scope.properties : []).find((p) => isElement(p) && (p.name || p.id) === name);
  if (isElement(property)) return literal(property.value);
  if (!model.isA(scope, BPMN.SubProcess)) return undefined;
  return wiredPropertiesIn(model, scope).find((wired) => wired.name === name)?.value;
}

/** The value `name` is declared with from `elementId` outward, the innermost declaration winning; `undefined` when
 * no scope declares one. What a condition there reads before any run writes it. */
export function declaredIn(model: StudyModel, elementId: string, name: string): unknown {
  for (let scope = model.get(elementId); scope; scope = model.parentOf(scope)) {
    const value = declaredOn(model, scope, name);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Lexical lookup of a dotted `path` from `elementId`: the element, then each container outward to the study root,
 * each read as the last run left it in the state, else as the file declares it ({@link declaredOn}), so a label shows
 * a threshold before any run. A lone `{reached}` is the element's own counter, `_meta.reached.<element id>`, and 0
 * when it has none — a run that never reached it counts 0, and so does a file no run has touched, never a
 * container's count. `state.a.b` is absolute (`state._meta.reached.X` included). `undefined` when nothing resolves.
 */
export function resolveStateIn(model: StudyModel, elementId: string, path: string): unknown {
  const keys = path.split('.').map((key) => key.trim()).filter(Boolean);
  if (keys.length === 0) return undefined;
  const tree: Record<string, any> = model.study.state ?? {};
  if (keys[0] === 'state') return lookup(tree, keys.slice(1));
  for (let scope = model.get(elementId); scope; scope = model.parentOf(scope)) {
    if (typeof scope.id !== 'string') continue;
    const run = lookup(tree, [scope.id, ...keys]);
    if (run !== undefined) return run;
    const declared = declaredOn(model, scope, keys[0]);
    const value = keys.length === 1 ? declared : lookup(declared, keys.slice(1));
    if (value !== undefined) return value;
  }
  return keys.length === 1 && keys[0] === REACHED ? tree[META_KEY]?.[REACHED]?.[elementId] ?? 0 : undefined;
}

/** Replaces every `{path}` that resolves with `String(value)`, and every `{path:%}` that resolves to a number with
 * it as a percentage; any other placeholder stays as written. */
export function resolvePlaceholdersIn(model: StudyModel, text: string, elementId: string): string {
  if (!text.includes('{')) return text;
  return text.replace(DRAWN, (match, path: string, percent: string | undefined) => {
    const value = resolveStateIn(model, elementId, path);
    if (value === undefined) return match;
    if (!percent) return String(value);
    return typeof value === 'number' ? asPercentage(value) : match;
  });
}

/** A number as `{name:%}` draws it: 0.2 as `20%`. */
export function asPercentage(value: number): string {
  // 0.07 * 100 is 7.000000000000001 in floating point; twelve digits drop the noise.
  return `${Number((value * 100).toPrecision(12))}%`;
}
