/**
 * Reading and writing a study model's elements as the canvas does: a reference is an id (a list of them where the
 * metamodel says many), what an element holds a list of elements.
 */

import { idOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index.ts';

export function nameOf(element: Element | undefined): string {
  return typeof element?.name === 'string' ? element.name : '';
}

/** The elements `element` holds under `key`. */
export function listOf(element: Element | undefined, key: string): Element[] {
  const value = element?.[key];
  return Array.isArray(value) ? value.filter(isElement) : [];
}

/** The ids a reference holds: one, or a list (a data association's `sourceRef`). */
export function idsIn(value: Value | undefined): string[] {
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(idOf).filter((id): id is string => !!id);
}

/** The element `owner` refers to under `key`: the first, when it refers to many. */
export function refOf(model: StudyModel, owner: Element | undefined, key: string): Element | undefined {
  return model.get(idsIn(owner?.[key])[0]);
}

/** Every element `owner` refers to under `key`. */
export function refsOf(model: StudyModel, owner: Element | undefined, key: string): Element[] {
  return idsIn(owner?.[key]).map((id) => model.get(id)).filter((target): target is Element => !!target);
}

/** Refer `owner` under `key` to `target`, as one id or a list of one where the metamodel says many; none clears it. */
export function setRef(model: StudyModel, owner: Element, key: string, target: Element | undefined): void {
  const many = model.property(owner, key)?.isMany === true;
  if (!target?.id) delete owner[key];
  else owner[key] = many ? [target.id] : target.id;
}

/** Add `target` to the references `owner` holds under `key`, once. */
export function addRef(owner: Element, key: string, target: Element): void {
  const ids = idsIn(owner[key]);
  if (target.id && !ids.includes(target.id)) owner[key] = [...ids, target.id];
}

/** Take `target` out of the references `owner` holds under `key`; whether it was there. An emptied list goes. */
export function dropRef(owner: Element, key: string, target: Element): boolean {
  const ids = idsIn(owner[key]);
  if (!target.id || !ids.includes(target.id)) return false;
  const rest = ids.filter((id) => id !== target.id);
  if (rest.length > 0) owner[key] = rest;
  else delete owner[key];
  return true;
}

/** A new element of `type`: `props` as given, its event definitions (`[{ type, ...fields }]`) its own. */
export function mint(type: string, props: Record<string, unknown> = {}): Element {
  return { type, ...(props as Record<string, Value>) };
}
