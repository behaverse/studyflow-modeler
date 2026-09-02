/**
 * Moddle access. Every helper works on a real `bpmn-moddle` object (through
 * `get`/`set`) and on a plain bag alike, and reads cardinality off the descriptor
 * rather than a hard-coded list.
 */

import type { ModdleObject } from '@canvas/model/scene.ts';

export function prop(target: ModdleObject | undefined, name: string): unknown {
  if (!target) return undefined;
  const getter = (target as { get?: (n: string) => unknown }).get;
  return typeof getter === 'function'
    ? getter.call(target, name)
    : (target as Record<string, unknown>)[name];
}

export function setProp(target: ModdleObject, name: string, value: unknown): void {
  const setter = (target as { set?: (n: string, v: unknown) => void }).set;
  if (typeof setter === 'function') setter.call(target, name, value);
  else (target as Record<string, unknown>)[name] = value;
}

export function asModdle(value: unknown): ModdleObject | undefined {
  return value && typeof value === 'object' && typeof (value as ModdleObject).$type === 'string'
    ? (value as ModdleObject)
    : undefined;
}

export function asList(value: unknown): ModdleObject[] {
  if (!Array.isArray(value)) return [];
  return value.map(asModdle).filter((item): item is ModdleObject => !!item);
}

export function listProp(owner: ModdleObject | undefined, name: string): ModdleObject[] {
  return asList(prop(owner, name));
}

export function nameOf(target: ModdleObject | undefined): string {
  const value = prop(target, 'name');
  return typeof value === 'string' ? value : '';
}

/** A reference may be a single element or a list (data associations). */
export function refBOs(value: unknown): ModdleObject[] {
  if (Array.isArray(value)) return asList(value);
  const single = asModdle(value);
  return single ? [single] : [];
}

export function refBO(value: unknown): ModdleObject | undefined {
  return refBOs(value)[0];
}

export function parentOf(target: ModdleObject | undefined): ModdleObject | undefined {
  return asModdle((target as { $parent?: unknown } | undefined)?.$parent);
}

export function setParent(child: ModdleObject, parent: ModdleObject | undefined): void {
  if (parent) (child as { $parent?: unknown }).$parent = parent;
}

export function clearParent(child: ModdleObject): void {
  (child as { $parent?: unknown }).$parent = undefined;
}

export type ModdleFactory = { create?: (type: string, props: object) => ModdleObject };

export function modelOf(target: ModdleObject | undefined): ModdleFactory | undefined {
  const model = (target as { $model?: unknown } | undefined)?.$model;
  return model && typeof model === 'object' ? (model as ModdleFactory) : undefined;
}

/** Mint through the document's own factory, or a plain bag when there is none. */
export function mint(factory: ModdleFactory | undefined, type: string, props: object = {}): ModdleObject {
  if (!factory?.create) return { $type: type, ...props } as ModdleObject;
  const { eventDefinitions, ...rest } = props as { eventDefinitions?: unknown };
  const bo = factory.create(type, rest);
  attachEventDefinitions(factory, bo, eventDefinitions);
  return bo;
}

/**
 * `eventDefinitions: [{ type: 'bpmn:TimerEventDefinition', ...fields }]` — the palette's
 * plain description of an event variant — becomes owned moddle objects on `bo`.
 * Entries that already are moddle objects (`$type`) pass through unchanged.
 */
export function attachEventDefinitions(factory: ModdleFactory | undefined, bo: ModdleObject, defs: unknown): void {
  if (!Array.isArray(defs) || !factory?.create) return;
  const owned = defs.map((def: Record<string, unknown>) => {
    if (def.$type) return def as ModdleObject;
    const { type, ...fields } = def as { type: string };
    const created = factory.create!(type, fields);
    (created as { $parent?: unknown }).$parent = bo;
    return created;
  });
  (bo as Record<string, unknown>).eventDefinitions = owned;
}

/** The `$type` of an event's first definition (`'bpmn:TimerEventDefinition'`), or `undefined` for a plain event. */
export function eventDefinitionTypeOf(bo: ModdleObject | undefined): string | undefined {
  const defs = (bo as { eventDefinitions?: unknown } | undefined)?.eventDefinitions;
  const first = Array.isArray(defs) ? defs[0] : undefined;
  return first?.$type ?? first?.type;
}

export function definitionsAbove(target: ModdleObject | undefined): ModdleObject | undefined {
  const guard = new Set<ModdleObject>();
  for (let cursor = target; cursor && !guard.has(cursor); cursor = parentOf(cursor)) {
    guard.add(cursor);
    if (cursor.$type === 'bpmn:Definitions') return cursor;
  }
  return undefined;
}

export function isManyProperty(target: ModdleObject, name: string): boolean {
  const descriptor = (target as {
    $descriptor?: { propertiesByName?: Record<string, { isMany?: boolean } | undefined> };
  }).$descriptor;
  return descriptor?.propertiesByName?.[name]?.isMany === true;
}

export function pushInto(owner: ModdleObject, name: string, value: ModdleObject): void {
  const current = prop(owner, name);
  if (Array.isArray(current)) {
    if (!current.includes(value)) current.push(value);
    return;
  }
  setProp(owner, name, [value]);
}

export function pullFrom(owner: ModdleObject | undefined, name: string, value: ModdleObject): boolean {
  if (!owner) return false;
  const current = prop(owner, name);
  if (!Array.isArray(current)) return false;
  const index = current.indexOf(value);
  if (index < 0) return false;
  current.splice(index, 1);
  return true;
}

/** Write a reference at the schema's cardinality (`sourceRef` is a list on a data association). */
export function setRef(owner: ModdleObject, name: string, value: ModdleObject | undefined): void {
  const many = isManyProperty(owner, name);
  if (!value) setProp(owner, name, many ? [] : undefined);
  else setProp(owner, name, many ? [value] : value);
}

export function clearRef(owner: ModdleObject, name: string): void {
  if (prop(owner, name) === undefined) return;
  setProp(owner, name, isManyProperty(owner, name) ? [] : undefined);
}

export function listPropertyNames(owner: ModdleObject): string[] {
  return Object.keys(owner).filter(
    (key) => !key.startsWith('$') && Array.isArray((owner as Record<string, unknown>)[key]),
  );
}

/**
 * Pull `bo` out of every list of every candidate owner and clear its `$parent`.
 * Scanning the lists rather than naming one property covers every containment
 * property a document may file an element under.
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
