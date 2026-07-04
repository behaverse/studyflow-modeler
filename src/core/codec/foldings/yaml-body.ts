import * as yaml from 'js-yaml';

import { toLocalName } from '@/core/naming';
import { YAML_DUMP_OPTIONS, valueTypeOf } from '@/core/codec/common';

/**
 * Folding #1 — YAML-bodied config wrappers and value-typed YAML properties.
 *
 * `cognitive:Configurations` and friends carry their whole content in a single
 * `YAMLString` body property; `studyflow:with` carries it in a value-typed
 * `YAMLString` property. On serialize the parsed body inlines as nested YAML
 * (instead of a `value: |` string block); on deserialize the nested mapping is
 * dumped back into that string property.
 *
 * The round-trip is guarded by two shared predicates so both directions agree
 * on which mappings qualify to inline:
 *
 *   - {@link qualifiesAsInlineBody} — for the wrapper body. A mapping inlines
 *     only if it is a non-empty mapping, carries no `type` key (that would be
 *     re-read as "build an element"), and is not entirely made of the wrapper's
 *     own declared properties (that would be re-read as the wrapped form).
 *   - {@link qualifiesAsInlineValue} — for value-typed properties. Same, minus
 *     the declared-keys check (a value property has no ambiguous wrapped form).
 */

/** A parsed YAML mapping (non-null, non-array object). */
type Mapping = Record<string, unknown>;

function asMapping(parsed: unknown): Mapping | undefined {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  return parsed as Mapping;
}

function parseMapping(text: unknown): Mapping | undefined {
  if (typeof text !== 'string' || text === '') return undefined;
  try {
    return asMapping(yaml.load(text));
  } catch {
    return undefined;
  }
}

/** The YAML-typed body property of a descriptor (`cognitive:Configurations#value`), if any. */
export function yamlBodyProperty(descriptor: any): any | undefined {
  const body = (descriptor?.properties ?? []).find((p: any) => p.isBody);
  return body && toLocalName(valueTypeOf(body)) === 'YAMLString' ? body : undefined;
}

/** True when a property is a value-typed (non-body) `YAMLString`, e.g. `studyflow:with`. */
export function isYamlValueProperty(prop: any): boolean {
  return !prop.isBody && toLocalName(valueTypeOf(prop)) === 'YAMLString';
}

function allKeysDeclared(node: Mapping, descriptor: any): boolean {
  const byName = descriptor?.propertiesByName ?? {};
  return Object.keys(node).every((key) => key in byName);
}

/**
 * Shared FOLD/UNFOLD predicate for wrapper bodies. A mapping qualifies to
 * inline as a config-wrapper body iff it is non-empty, carries no `type` key,
 * and is not entirely the wrapper's own declared properties.
 */
export function qualifiesAsInlineBody(node: Mapping, descriptor: any): boolean {
  const keys = Object.keys(node);
  if (keys.length === 0 || 'type' in node) return false;
  return !allKeysDeclared(node, descriptor);
}

/**
 * Shared FOLD/UNFOLD predicate for value-typed YAML properties. A mapping is an
 * inlined value (as opposed to a `type`-tagged element to build) iff it carries
 * no `type` key. This is the invariant both directions must agree on.
 *
 * On FOLD, {@link inlineYamlValue} additionally skips empty mappings — there is
 * nothing worth inlining — but on UNFOLD an empty mapping still round-trips as a
 * dumped value string, so emptiness is a serialize-only concern.
 */
export function qualifiesAsInlineValue(node: Mapping): boolean {
  return !('type' in node);
}

/**
 * FOLD (serialize): a config wrapper whose whole content is a YAML body inlines
 * that parsed body as nested YAML. Returns undefined (keep the wrapper) when the
 * element carries raw attributes, extra set properties, or a body that does not
 * {@link qualifiesAsInlineBody}.
 */
export function inlineYamlBody(el: any): Mapping | undefined {
  const descriptor = el.$descriptor;
  const props: any[] = descriptor?.properties ?? [];
  const body = props.find((p) => p.isBody);
  if (!body || toLocalName(valueTypeOf(body)) !== 'YAMLString') return undefined;
  if (typeof el[body.name] !== 'string' || el[body.name] === '') return undefined;
  if (Object.keys(el.$attrs ?? {}).length > 0) return undefined;
  for (const p of props) {
    if (p === body) continue;
    const value = el[p.name];
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) return undefined;
  }

  const parsed = parseMapping(el[body.name]);
  if (!parsed || !qualifiesAsInlineBody(parsed, descriptor)) return undefined;
  return parsed;
}

/**
 * FOLD (serialize): a value-typed YAML property (`studyflow:with`) inlines its
 * parsed mapping as nested YAML. Bodies are excluded — those fold at the wrapper
 * level via {@link inlineYamlBody}. Returns undefined (keep the string) when the
 * value does not parse to a mapping that {@link qualifiesAsInlineValue}.
 */
export function inlineYamlValue(value: any, prop: any): Mapping | undefined {
  if (!isYamlValueProperty(prop)) return undefined;
  const parsed = parseMapping(value);
  if (!parsed || Object.keys(parsed).length === 0 || !qualifiesAsInlineValue(parsed)) return undefined;
  return parsed;
}

/** UNFOLD (deserialize): dump an inlined value mapping back into its string form. */
export function foldInlineValue(raw: Mapping): string {
  return yaml.dump(raw, YAML_DUMP_OPTIONS);
}

/** UNFOLD (deserialize): dump an inlined body mapping back into the wrapper's string form. */
export function foldInlineBody(node: Mapping): string {
  return yaml.dump(node, YAML_DUMP_OPTIONS);
}
