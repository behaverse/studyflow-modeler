import { getProperty, setProperty, type Moddle, type ModdleElement } from '@core/element/moddle';
import { STUDY_EXTENSION_TYPE, primaryRoots, studyExtensionOf } from '@core/document/format';

/**
 * The retrospective `state` tree (docs/design/state.md): keyed by element id, stored as a JSON string on
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
  const root: any = primaryRoots(definitions)[0];
  if (!root) return undefined;
  let holder = root.extensionElements;
  if (!holder) {
    holder = moddle.create('bpmn:ExtensionElements', { values: [] });
    holder.$parent = root;
    root.set('extensionElements', holder);
  }
  const study = moddle.create(STUDY_EXTENSION_TYPE, {});
  study.$parent = holder;
  holder.get('values').push(study);
  return study;
}

/** The parsed tree; `{}` when absent or not a JSON object. */
export function readState(definitions: ModdleElement | null | undefined): StateTree {
  const raw = getProperty(studyExtensionOf(definitions), 'state');
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

/**
 * Lexical lookup of a dotted `path` from `elementId`: the element's own entry, then each container outward to
 * the study root; a single-segment path also falls back to that scope's runner counter, `_meta.<path>.<scope>`.
 * `state.a.b` is absolute (`state._meta.reached.X` included). `undefined` when nothing resolves.
 */
export function resolveState(definitions: ModdleElement | null | undefined, elementId: string, path: string): unknown {
  const keys = path.split('.').map((key) => key.trim()).filter(Boolean);
  if (keys.length === 0) return undefined;
  const tree = readState(definitions);
  if (keys[0] === 'state') return lookup(tree, keys.slice(1));
  for (let scope = findElement(definitions, elementId); scope && scope.$type !== 'bpmn:Definitions'; scope = scope.$parent) {
    if (typeof scope.id !== 'string') continue;
    const value = lookup(tree, [scope.id, ...keys]) ?? (keys.length === 1 ? tree[META_KEY]?.[keys[0]]?.[scope.id] : undefined);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Replaces every `{path}` that resolves with `String(value)`; an unresolved placeholder stays as written. */
export function resolvePlaceholders(text: string, definitions: ModdleElement | null | undefined, elementId: string): string {
  if (!text.includes('{')) return text;
  return text.replace(/\{([^{}]+)\}/g, (match, body: string) => {
    const value = resolveState(definitions, elementId, body);
    return value === undefined ? match : String(value);
  });
}
