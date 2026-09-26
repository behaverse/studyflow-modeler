import { getProperty, moveProperties, setProperty, type Moddle, type ModdleElement } from '@core/element/moddle';
import { STUDY_EXTENSION_TYPE, primaryRoot, studyExtensionOf } from '@core/document/format';

/**
 * The retrospective `state` tree (docs/developers.qmd, "What a run leaves behind"): keyed by element id, stored as a JSON string on
 * the `studyflow:Study` extension, lifted to the top-level `state:` mapping of a `.studyflow` file.
 */

export type StateTree = Record<string, any>;

/** The one runner-owned key: `state._meta.prov` (run records) and `state._meta.<quantity>.<element_id>` (e.g. `reached`). */
export const META_KEY = '_meta';

/** Keys starting with `_` are the runner's own; authors cannot declare properties with such names. */
export function isReservedStateKey(name: string): boolean {
  return name.startsWith('_');
}

/** The `studyflow:Study` extension of the primary root, created (with its `extensionElements`) when missing. */
export function ensureStudyExtension(definitions: ModdleElement, moddle: Moddle): ModdleElement | undefined {
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

/** What a root keeps when the study passes on: its id (swapped instead), its content, and its extensions but the Study. */
const KEPT_BY_ROOT = new Set(['id', 'artifacts', 'extensionElements']);

/**
 * The study is the diagram's root, whichever kind it is: the canvas turns a process root into a collaboration
 * when the first pool is drawn, and back when the last one is deleted, and the study stays one object through
 * both. `to` takes the study over from `from`: its id, the fields both kinds declare (name, documentation, tags)
 * and the Study; `from` takes `freshId`. The process's entry in the run state follows the process's id, since
 * its properties are what the entry holds.
 */
export function handOverStudy(from: ModdleElement, to: ModdleElement, freshId: string): void {
  const process = from.$type === 'bpmn:Process' ? from : to;
  const scope = process.id;
  to.id = from.id;
  from.id = freshId;
  const shared = to.$descriptor?.propertiesByName ?? {};
  const names = (from.$descriptor?.properties ?? [])
    .map((property: { name: string }) => property.name)
    .filter((name: string) => !KEPT_BY_ROOT.has(name) && shared[name]);
  moveProperties(to, from, names);

  const values: ModdleElement[] = from.extensionElements?.get('values') ?? [];
  const study = values.find((value) => value.$type === STUDY_EXTENSION_TYPE);
  if (!study) return;
  values.splice(values.indexOf(study), 1);
  if (values.length === 0) from.set?.('extensionElements', undefined);
  const holder = extensionElementsOf(to, from.$model);
  study.$parent = holder;
  holder.get('values').push(study);
  if (scope && process.id) renameStateEntry(study, scope, process.id);
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

/** A scope's entry on `study` follows its element to a new id; the other entries keep their place. */
function renameStateEntry(study: ModdleElement, from: string, to: string): void {
  const tree = stateOn(study);
  if (!(from in tree)) return;
  const renamed = Object.entries(tree).map(([key, value]) => [key === from ? to : key, value]);
  setProperty(study, 'state', JSON.stringify(Object.fromEntries(renamed)));
}

/** JSON-encodes `tree` onto the Study extension (created when missing); an empty tree removes the property. */
export function writeState(definitions: ModdleElement, moddle: Moddle, tree: StateTree | null | undefined): void {
  const empty = !tree || Object.keys(tree).length === 0;
  const study = empty ? studyExtensionOf(definitions) : ensureStudyExtension(definitions, moddle);
  if (!study) return;
  setProperty(study, 'state', empty ? undefined : JSON.stringify(tree));
}

function findElement(definitions: ModdleElement | null | undefined, id: string): any {
  const visit = (el: any): any => {
    if (!el) return undefined;
    if (el.id === id) return el;
    for (const child of el.flowElements ?? []) {
      const found = visit(child);
      if (found) return found;
    }
    return undefined;
  };
  for (const root of definitions?.rootElements ?? []) {
    const found = visit(root);
    if (found) return found;
  }
  return undefined;
}

function lookup(node: unknown, keys: string[]): unknown {
  if (keys.length === 0) return undefined;
  let current: any = node;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

/** The runner counter a lone name may cite: how often a token reached the element citing it. */
const REACHED = 'reached';

/**
 * Lexical lookup of a dotted `path` from `elementId`: the element's own entry, then each container outward to
 * the study root. A lone `{reached}` is the element's own counter, `_meta.reached.<element id>`, and 0 when it has
 * none — a run that never reached it counts 0, and so does a file no run has touched, never a container's count.
 * `state.a.b` is absolute (`state._meta.reached.X` included). `undefined` when nothing resolves.
 */
export function resolveState(definitions: ModdleElement | null | undefined, elementId: string, path: string): unknown {
  const keys = path.split('.').map((key) => key.trim()).filter(Boolean);
  if (keys.length === 0) return undefined;
  const tree = readState(definitions);
  if (keys[0] === 'state') return lookup(tree, keys.slice(1));
  for (let scope = findElement(definitions, elementId); scope && scope.$type !== 'bpmn:Definitions'; scope = scope.$parent) {
    if (typeof scope.id !== 'string') continue;
    const value = lookup(tree, [scope.id, ...keys]);
    if (value !== undefined) return value;
  }
  return keys.length === 1 && keys[0] === REACHED ? tree[META_KEY]?.[REACHED]?.[elementId] ?? 0 : undefined;
}

/**
 * A placeholder, `{name}` or `{name.field}`, the one form every reader takes (docs/reference.qmd, "Placeholders"):
 * a letter of any script or `_`, then letters, digits, `_`, `-` and dots, so the braces of YAML or JSON in a value
 * stay put. The Python runners spell it `[^\W\d][\w.-]*`, which matches the same names wherever the two engines'
 * Unicode tables agree.
 */
export const PLACEHOLDER = /\{\s*([\p{L}\p{Nl}\p{No}_][\p{L}\p{N}_.-]*)\s*\}/gu;

/** Replaces every `{path}` the last run's state resolves with `String(value)`; an unresolved placeholder stays as written. */
export function resolvePlaceholders(text: string, definitions: ModdleElement | null | undefined, elementId: string): string {
  if (!text.includes('{')) return text;
  return text.replace(PLACEHOLDER, (match, path: string) => {
    const value = resolveState(definitions, elementId, path);
    return value === undefined ? match : String(value);
  });
}
