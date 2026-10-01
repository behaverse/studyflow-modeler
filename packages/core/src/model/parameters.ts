/**
 * What a step reads from the `studyflow:Parameters` wired into it: a key that names one of the step's attributes sets
 * that attribute, the rest is the step's configuration. Only a wire makes a Parameters object take effect. The plan
 * a run walks applies this (`@core/engine/plan`), and so does the browser runtime, once a link's values are bound.
 */
import * as yaml from 'js-yaml';

import { idOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index';

export const PARAMETERS = 'studyflow:Parameters';

type Mapping = Record<string, unknown>;

const isMapping = (value: unknown): value is Mapping => !!value && typeof value === 'object' && !Array.isArray(value);

const listIn = (value: Value | undefined): Value[] => (Array.isArray(value) ? value : []);

/** Whether `path` (`Bot.Speed`, `Streams.0`) leads to a value inside `node`. */
export function hasPath(node: unknown, path: string[]): boolean {
  for (const key of path) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, key)) return false;
    node = (node as Mapping)[key];
  }
  return true;
}

/** What a reader reads from several Parameters, merged. Mappings merge key by key; a value two of them set is an
 * error, since nothing drawn orders the wires. */
export function mergeParameters(readerId: string, sources: [string, Mapping][]): Mapping {
  const into = (target: Mapping, source: Mapping, id: string, path: string[]): void => {
    for (const [key, value] of Object.entries(source)) {
      const at = [...path, key];
      if (!Object.hasOwn(target, key)) {
        target[key] = structuredClone(value);
      } else if (isMapping(target[key]) && isMapping(value)) {
        into(target[key], value, id, at);
      } else {
        const [other] = sources.find(([, carried]) => hasPath(carried, at))!;
        throw new Error(`${readerId} reads ${at.join('.')} from both ${other} and ${id}: set it in one of them.`);
      }
    }
  };
  const merged: Mapping = {};
  for (const [id, carried] of sources) into(merged, carried, id, []);
  return merged;
}

/** The mapping a `studyflow:Parameters` data object carries; undefined for any other element, or an empty one. */
export function parametersIn(model: StudyModel, element: Element | undefined): Record<string, unknown> | undefined {
  if (!element || model.extensionType(element) !== PARAMETERS) return undefined;
  const entry = element.type === PARAMETERS ? element : model.entries(element).find((candidate) => candidate.type === PARAMETERS);
  let values: unknown = entry?.values;
  if (typeof values === 'string') {
    try {
      values = yaml.load(values);
    } catch {
      return undefined;
    }
  }
  return values && typeof values === 'object' && !Array.isArray(values) && Object.keys(values).length > 0 ? values as Record<string, unknown> : undefined;
}

/** The attributes a Parameters key may set on `element`: the XML attributes its schema type declares. */
export function overridableIn(model: StudyModel, element: Element): Set<string> {
  const type = model.extensionType(element);
  if (!type) return new Set();
  return new Set(model.metamodel.descriptor(type).properties
    .filter((p) => p.isAttr && p.ns.prefix !== 'bpmn')
    .map((p) => p.ns.localName));
}

/** The Parameters wired into `element`, by id, in the order its associations are written. */
export function wiredSourcesIn(model: StudyModel, element: Element): [string, Mapping][] {
  const sources: [string, Mapping][] = [];
  for (const association of listIn(element.dataInputAssociations).filter(isElement)) {
    for (const ref of listIn(association.sourceRef)) {
      const id = idOf(ref);
      const values = parametersIn(model, model.get(id ?? undefined));
      if (id && values && !sources.some(([known]) => known === id)) sources.push([id, values]);
    }
  }
  return sources;
}

/** `values`, what `element` reads from its Parameters, split: the keys naming one of its attributes set it, the rest
 * is its configuration. An attribute takes one value, never a mapping or a list. */
export function splitIn(model: StudyModel, element: Element, values: Mapping): { attributes: Mapping; rest: Mapping } {
  const names = overridableIn(model, element);
  const attributes: Mapping = {};
  const rest: Mapping = {};
  for (const [key, value] of Object.entries(values)) {
    if (!names.has(key)) rest[key] = value;
    else if (value === null || typeof value === 'object') {
      const got = value === null ? 'nothing' : Array.isArray(value) ? 'a list' : 'a mapping';
      throw new Error(`${element.id} reads ${key}, one of its attributes, which takes one value, not ${got}.`);
    } else attributes[key] = value;
  }
  return { attributes, rest };
}

/** The Parameters wired into `element`, merged and split into the attributes they set and the rest. */
export function wiredIn(model: StudyModel, element: Element): { attributes: Mapping; rest: Mapping } | undefined {
  const sources = wiredSourcesIn(model, element);
  return sources.length === 0 ? undefined : splitIn(model, element, mergeParameters(element.id!, sources));
}
