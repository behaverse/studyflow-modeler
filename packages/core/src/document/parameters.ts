import * as yaml from 'js-yaml';

import { StudyflowElement, getAttribute, toBusinessObject } from '@core/element';
import type { ModdleElement } from '@core/element/moddle';

/* What a step reads from the `studyflow:Parameters` wired into it: a key that names one of the step's attributes sets
   that attribute, the rest is the step's configuration. Only a wire makes a Parameters object take effect. The
   browser runner applies this at run time, `skills/local/run.py` the same way; the inspector shows it. */

export const PARAMETERS_TYPE = 'studyflow:Parameters';

type Mapping = Record<string, unknown>;

const isMapping = (value: unknown): value is Mapping => !!value && typeof value === 'object' && !Array.isArray(value);

const parsed = new WeakMap<object, { text: string; values: Mapping | undefined }>();

/** The mapping a `studyflow:Parameters` data object carries; undefined for any other element, or an empty or unreadable one. */
export function parametersOf(elementOrBO: unknown): Mapping | undefined {
  const element = StudyflowElement.fromBusinessObject(elementOrBO);
  if (element.extensionType !== PARAMETERS_TYPE) return undefined;
  const text = getAttribute(element.businessObject, 'values');
  if (typeof text !== 'string' || !text.trim()) return undefined;
  const cached = parsed.get(element.extension!);
  if (cached?.text === text) return cached.values;
  let values: Mapping | undefined;
  try {
    const loaded = yaml.load(text);
    values = isMapping(loaded) && Object.keys(loaded).length > 0 ? loaded : undefined;
  } catch {
    values = undefined;
  }
  parsed.set(element.extension!, { text, values });
  return values;
}

export type ParametersSource = { source: ModdleElement; values: Mapping };

/** The Parameters data objects wired into a step, in the order its associations are written. */
export function wiredParameters(elementOrBO: unknown): ParametersSource[] {
  const sources: ParametersSource[] = [];
  for (const association of toBusinessObject(elementOrBO)?.dataInputAssociations ?? []) {
    for (const source of association?.sourceRef ?? []) {
      const values = parametersOf(source);
      if (values && !sources.some((known) => known.source === source)) sources.push({ source, values });
    }
  }
  return sources;
}

/** Whether `path` (`Bot.Speed`, `Streams.0`) leads to a value inside `node`. */
export function hasPath(node: unknown, path: string[]): boolean {
  for (const key of path) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, key)) return false;
    node = (node as Mapping)[key];
  }
  return true;
}

/** What a reader reads from several Parameters, merged. Mappings merge key by key; a value two of them set is an
 * error, since nothing drawn orders the wires. `skills/local/run.py` merges the same way. */
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

/** The attributes a Parameters key may set on an element: the XML attributes its own type declares, by local name. */
export function overridableAttributes(elementOrBO: unknown): Set<string> {
  return new Set(StudyflowElement.fromBusinessObject(elementOrBO).extensionAttributes()
    .filter((spec) => spec.isAttr && spec.ns?.prefix !== 'bpmn')
    .map((spec) => spec.ns.localName));
}

/** Splits what an element reads into the attributes it sets and the rest, its configuration. An attribute takes one
 * value: a mapping, a list or nothing under its name is an error. */
export function splitAttributes(elementOrBO: unknown, values: Mapping, readerId: string): { attributes: Mapping; rest: Mapping } {
  const names = overridableAttributes(elementOrBO);
  const attributes: Mapping = {};
  const rest: Mapping = {};
  for (const [key, value] of Object.entries(values)) {
    if (!names.has(key)) {
      rest[key] = value;
    } else if (value === null || typeof value === 'object') {
      const got = value === null ? 'nothing' : Array.isArray(value) ? 'a list' : 'a mapping';
      throw new Error(`${readerId} reads ${key}, one of its attributes, which takes one value, not ${got}.`);
    } else {
      attributes[key] = value;
    }
  }
  return { attributes, rest };
}

export type AttributeOverride = {
  /** The attribute's local name, the key that sets it. */
  attribute: string;
  value: unknown;
  /** The Parameters objects setting it: more than one is a clash a run refuses. */
  sources: ModdleElement[];
};

/** Which of a step's attributes the Parameters wired into it set, by local name. */
export function attributeOverrides(elementOrBO: unknown): Map<string, AttributeOverride> {
  const sources = wiredParameters(elementOrBO);
  const overrides = new Map<string, AttributeOverride>();
  if (sources.length === 0) return overrides;
  const names = overridableAttributes(elementOrBO);
  for (const { source, values } of sources) {
    for (const [key, value] of Object.entries(values)) {
      if (!names.has(key)) continue;
      const known = overrides.get(key);
      if (known) known.sources.push(source);
      else overrides.set(key, { attribute: key, value, sources: [source] });
    }
  }
  return overrides;
}

/** The read-only properties a sub-process takes from the Parameters wired into it: each key that sets none of its
 * attributes, beside the properties it declares. */
export function wiredProperties(elementOrBO: unknown): { name: string; value: unknown; source: ModdleElement }[] {
  const names = overridableAttributes(elementOrBO);
  return wiredParameters(elementOrBO).flatMap(({ source, values }) => Object.entries(values)
    .filter(([key]) => !names.has(key))
    .map(([name, value]) => ({ name, value, source })));
}

/** An attribute as a run reads it: the value a Parameters object sets, else the element's own. */
export function effectiveAttribute(elementOrBO: unknown, name: string): unknown {
  const override = attributeOverrides(elementOrBO).get(name);
  return override ? override.value : getAttribute(elementOrBO, name);
}
