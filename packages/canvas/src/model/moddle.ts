/**
 * Moddle access — the one place the canvas reads, writes, mints and unfiles
 * `bpmn-moddle` objects (design §1 option (c): "mutate the live moddle BO + DI
 * objects, never rebuild the `Definitions` tree").
 *
 * Every helper is deliberately defensive in the same two ways:
 *
 * 1. **`get`/`set` when the object has them, plain property access when it does
 *    not** — a hand-built plain-object scene (what several specs use) flows through
 *    exactly the same code paths as a real `bpmn-moddle` tree.
 * 2. **Cardinality comes from the descriptor, never from a hard-coded list** —
 *    `sourceRef` is a single `bpmn:FlowNode` on a `bpmn:SequenceFlow` but a *list*
 *    of item-aware elements on a `bpmn:DataInputAssociation`, so
 *    {@link setRef}/{@link clearRef} ask `$descriptor.propertiesByName` which one
 *    this owner means.
 *
 * The writers all mint through the factory reachable from an object the document
 * already holds (`$model`), so everything created here is a first-class member of
 * the very tree `model/import.ts` walked, and `bpmn-moddle`'s `toXML` re-emits it
 * without any further bookkeeping.
 */

import type { ModdleObject } from '@canvas/model/scene.ts';

// --- reading ----------------------------------------------------------------

/** Read a property off a moddle element, tolerating a plain parsed bag. */
export function prop(target: ModdleObject | undefined, name: string): unknown {
  if (!target) return undefined;
  const getter = (target as { get?: (n: string) => unknown }).get;
  return typeof getter === 'function'
    ? getter.call(target, name)
    : (target as Record<string, unknown>)[name];
}

/** Set a property on a moddle element via its `set`, else assign directly. */
export function setProp(target: ModdleObject, name: string, value: unknown): void {
  const setter = (target as { set?: (n: string, v: unknown) => void }).set;
  if (typeof setter === 'function') setter.call(target, name, value);
  else (target as Record<string, unknown>)[name] = value;
}

/** `value` as a moddle element, or `undefined` when it is not one. */
export function asModdle(value: unknown): ModdleObject | undefined {
  return value && typeof value === 'object' && typeof (value as ModdleObject).$type === 'string'
    ? (value as ModdleObject)
    : undefined;
}

/** `value` as a list of moddle elements (non-elements dropped). */
export function asList(value: unknown): ModdleObject[] {
  if (!Array.isArray(value)) return [];
  return value.map(asModdle).filter((item): item is ModdleObject => !!item);
}

/** The list-valued property `name` of `owner`, as a (possibly empty) element list. */
export function listProp(owner: ModdleObject | undefined, name: string): ModdleObject[] {
  return asList(prop(owner, name));
}

/** An element's `name`, as a string (`''` when absent). */
export function nameOf(target: ModdleObject | undefined): string {
  const value = prop(target, 'name');
  return typeof value === 'string' ? value : '';
}

/** A reference may be a single element or a `[element, …]` list (data associations). */
export function refBOs(value: unknown): ModdleObject[] {
  if (Array.isArray(value)) return asList(value);
  const single = asModdle(value);
  return single ? [single] : [];
}

/** The first element of a reference property, whichever cardinality it has. */
export function refBO(value: unknown): ModdleObject | undefined {
  return refBOs(value)[0];
}

// --- the moddle meta-fields (`$`-prefixed; `get` does not serve them) --------

/** The moddle `$parent` back-link. */
export function parentOf(target: ModdleObject | undefined): ModdleObject | undefined {
  return asModdle((target as { $parent?: unknown } | undefined)?.$parent);
}

/** Write the moddle `$parent` back-link (no-op without a parent). */
export function setParent(child: ModdleObject, parent: ModdleObject | undefined): void {
  if (parent) (child as { $parent?: unknown }).$parent = parent;
}

/** Clear the moddle `$parent` back-link of a detached element. */
export function clearParent(child: ModdleObject): void {
  (child as { $parent?: unknown }).$parent = undefined;
}

/** A moddle factory: the `$model` a moddle object was minted by. */
export type ModdleFactory = { create?: (type: string, props: object) => ModdleObject };

/** The moddle factory that minted `target` (`$model`), if any. */
export function modelOf(target: ModdleObject | undefined): ModdleFactory | undefined {
  const model = (target as { $model?: unknown } | undefined)?.$model;
  return model && typeof model === 'object' ? (model as ModdleFactory) : undefined;
}

/**
 * Mint a moddle object of `type` through `factory` (the `$model` of an object the
 * document already holds), falling back to a plain bag when no factory is reachable
 * — the same defensive shape the readers above have, so a hand-built test scene
 * without a real `bpmn-moddle` still works.
 */
export function mint(
  factory: ModdleFactory | undefined,
  type: string,
  props: object = {},
): ModdleObject {
  if (factory?.create) return factory.create(type, props);
  return { $type: type, ...props } as ModdleObject;
}

/** The `bpmn:Definitions` root above `target`, if the `$parent` chain reaches one. */
export function definitionsAbove(target: ModdleObject | undefined): ModdleObject | undefined {
  let cursor = target;
  const guard = new Set<ModdleObject>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    if (cursor.$type === 'bpmn:Definitions') return cursor;
    cursor = parentOf(cursor);
  }
  return undefined;
}

// --- list + reference properties --------------------------------------------

/** Whether `name` is a list-valued (`isMany`) property of `target`'s moddle descriptor. */
export function isManyProperty(target: ModdleObject, name: string): boolean {
  const descriptor = (target as {
    $descriptor?: { propertiesByName?: Record<string, { isMany?: boolean } | undefined> };
  }).$descriptor;
  return descriptor?.propertiesByName?.[name]?.isMany === true;
}

/** Append `value` to the list-valued property `name` of `owner`, creating the list if absent. */
export function pushInto(owner: ModdleObject, name: string, value: ModdleObject): void {
  const current = prop(owner, name);
  if (Array.isArray(current)) {
    if (!current.includes(value)) current.push(value);
    return;
  }
  setProp(owner, name, [value]);
}

/** Remove `value` from the list property `name` of `owner`; whether it was there. */
export function pullFrom(owner: ModdleObject | undefined, name: string, value: ModdleObject): boolean {
  if (!owner) return false;
  const current = prop(owner, name);
  if (!Array.isArray(current)) return false;
  const index = current.indexOf(value);
  if (index < 0) return false;
  current.splice(index, 1);
  return true;
}

/**
 * Write a reference property, honouring the schema's cardinality: `sourceRef` is a
 * single `bpmn:FlowNode` on a `bpmn:SequenceFlow` but a *list* of item-aware
 * elements on a `bpmn:DataInputAssociation`, so the descriptor decides.
 */
export function setRef(owner: ModdleObject, name: string, value: ModdleObject | undefined): void {
  if (!value) {
    setProp(owner, name, isManyProperty(owner, name) ? [] : undefined);
    return;
  }
  setProp(owner, name, isManyProperty(owner, name) ? [value] : value);
}

/** Clear a reference property, honouring the schema's cardinality (`[]` vs `undefined`). */
export function clearRef(owner: ModdleObject, name: string): void {
  if (prop(owner, name) === undefined) return;
  setProp(owner, name, isManyProperty(owner, name) ? [] : undefined);
}

/**
 * Every list-valued own property of `owner` — the search space for "which container
 * is this business object filed in?". Moddle assigns set properties straight onto
 * the instance under their local names, so the own keys are authoritative.
 */
export function listPropertyNames(owner: ModdleObject): string[] {
  const names = new Set<string>();
  for (const key of Object.keys(owner)) {
    if (key.startsWith('$')) continue;
    if (Array.isArray((owner as Record<string, unknown>)[key])) names.add(key);
  }
  return [...names];
}

/**
 * Unfile `bo` from every list of every candidate owner — its moddle `$parent` plus
 * any extra owner the caller knows can hold it (an activity holds its own
 * `dataInputAssociations`, a collaboration its `messageFlows`). Returns the owners
 * something was actually pulled from, and clears `bo`'s `$parent`.
 *
 * Scanning the owner's lists rather than naming one property is deliberate: the
 * containment property depends on the BPMN type (`flowElements` / `artifacts` /
 * `participants` / `lanes` / `messageFlows` / `data*Associations`), and a document
 * loaded from XML may file an element somewhere a hard-coded list would miss.
 */
export function unfile(bo: ModdleObject, owners: readonly (ModdleObject | undefined)[]): ModdleObject[] {
  const touched: ModdleObject[] = [];
  const seen = new Set<ModdleObject>();
  for (const owner of owners) {
    if (!owner || seen.has(owner)) continue;
    seen.add(owner);
    let pulled = false;
    for (const name of listPropertyNames(owner)) pulled = pullFrom(owner, name, bo) || pulled;
    if (pulled) touched.push(owner);
  }
  clearParent(bo);
  return touched;
}
