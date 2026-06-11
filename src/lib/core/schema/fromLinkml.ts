import * as yaml from 'js-yaml';
import type {
  SchemaEnumModel,
  SchemaModel,
  SchemaPropertyModel,
  SchemaTypeModel,
} from './model';

/**
 * LinkML front-end: maps a LinkML schema to the IR.
 *
 * Mapping (the contract for authoring Studyflow schemas in LinkML):
 *
 * | LinkML                                | IR                                       |
 * |---------------------------------------|------------------------------------------|
 * | `types: X {base: str}`                | value type `X` (superClass `[String]`)   |
 * | `enums: E {permissible_values}`       | enumeration `E` (value -> literal)       |
 * | class, `mixin: true`, `class_uri:     | trait: attributes mixed onto the BPMN    |
 * |   bpmn:X`                             | type and its subtypes (`extends: [X]`)   |
 * | class, `class_uri: bpmn:X`            | wrapper type attached to `bpmn:X`        |
 * | class, `class_uri: <prefix>:<Name>`   | identity: the type belongs to `<prefix>` |
 * | `is_a: Parent`                        | `superClass: [<parent identity>]`        |
 * | `mixins: [T]` where `T` is a trait    | dropped (the trait applies via the BPMN  |
 * |                                       | business object already)                 |
 * | attribute `range`                     | property `type` (builtins/value types/   |
 * |                                       | enums; class ranges become `String` refs)|
 * | `multivalued: true`                   | `isMany: true`                           |
 * | `required: true`                      | `meta.required: true`                    |
 * | `ifabsent: string(x)` / `"false"`     | `default`                                |
 * | `slot_usage: {s: {equals_string}}`    | pinned redefinition of inherited `s`     |
 * | `annotations: {...}`                  | `meta.*` (icon, categories, bpmnType,    |
 * |                                       | connectsTo, …)                           |
 *
 * One LinkML file can declare classes for several Studyflow schemas (via
 * `class_uri` prefixes), so this returns one `SchemaModel` per prefix, the
 * file's `default_prefix` first.
 */
export function fromLinkml(yamlText: string): SchemaModel[] {
  const doc: any = yaml.load(yamlText);
  if (!doc || typeof doc !== 'object') throw new Error('LinkML schema did not parse to an object.');

  const defaultPrefix: string = doc.default_prefix ?? doc.name;
  if (!defaultPrefix) throw new Error('LinkML schema must declare `name` or `default_prefix`.');

  const prefixUris: Record<string, string> = doc.prefixes ?? {};
  const classes: Record<string, any> = doc.classes ?? {};
  const valueTypes: Record<string, any> = doc.types ?? {};
  const enums: Record<string, any> = doc.enums ?? {};

  const valueTypeNames = new Set(Object.keys(valueTypes));
  const enumNames = new Set(Object.keys(enums));
  const traitNames = new Set(
    Object.entries(classes).filter(([, c]) => c?.mixin === true).map(([name]) => name),
  );

  /** prefix + local name a class is registered under. */
  function identityOf(className: string): { prefix: string; localName: string } {
    const classUri: string | undefined = classes[className]?.class_uri;
    if (classUri && classUri.includes(':') && !classUri.startsWith('bpmn:')) {
      const [prefix, localName] = classUri.split(':', 2);
      return { prefix, localName };
    }
    return { prefix: defaultPrefix, localName: className };
  }

  function qualifiedIdentityOf(className: string): string {
    const { prefix, localName } = identityOf(className);
    return `${prefix}:${localName}`;
  }

  const LINKML_BUILTINS: Record<string, string> = {
    string: 'String',
    boolean: 'Boolean',
    integer: 'Integer',
    float: 'Real',
    double: 'Real',
    decimal: 'Real',
    uri: 'String',
    uriorcurie: 'String',
    date: 'String',
    datetime: 'String',
    time: 'String',
  };

  function mapRange(range: string | undefined): { type: string; meta?: Record<string, any> } {
    if (!range) return { type: 'String' };
    if (LINKML_BUILTINS[range]) return { type: LINKML_BUILTINS[range] };
    if (valueTypeNames.has(range)) return { type: `${defaultPrefix}:${range}` };
    if (enumNames.has(range)) return { type: `${defaultPrefix}:${range}` };
    if (classes[range]) {
      // Class-valued range: serialized as a reference string; keep the
      // intended range so future validation can resolve it.
      return { type: 'String', meta: { linkmlRange: qualifiedIdentityOf(range) } };
    }
    return { type: range };
  }

  function parseIfabsent(raw: unknown): unknown {
    if (raw === undefined || raw === null) return undefined;
    const text = String(raw);
    const wrapped = /^string\((.*)\)$/.exec(text);
    if (wrapped) return wrapped[1];
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text !== '' && !Number.isNaN(Number(text))) return Number(text);
    return text;
  }

  /** LinkML annotations may be plain values or `{tag, value}` objects. */
  function annotationsToMeta(annotations: any): Record<string, any> {
    const meta: Record<string, any> = {};
    for (const [key, raw] of Object.entries(annotations ?? {})) {
      meta[key] = raw && typeof raw === 'object' && 'value' in (raw as any) ? (raw as any).value : raw;
    }
    return meta;
  }

  function compileAttribute(name: string, spec: any): SchemaPropertyModel {
    const { type, meta: rangeMeta } = mapRange(spec?.range);
    const meta: Record<string, any> = {
      ...rangeMeta,
      ...annotationsToMeta(spec?.annotations),
      ...(spec?.required === true ? { required: true } : {}),
    };
    const property: SchemaPropertyModel = {
      name,
      type,
      description: spec?.description,
      ...(spec?.multivalued === true ? { isMany: true, isAttr: false } : { isAttr: true }),
    };
    const fallback = parseIfabsent(spec?.ifabsent);
    if (fallback !== undefined) property.default = fallback;
    if (Object.keys(meta).length > 0) property.meta = meta;
    return property;
  }

  /** Find the range of an inherited slot by walking `is_a` ancestors. */
  function inheritedRange(className: string, slotName: string): string | undefined {
    let current: any = classes[classes[className]?.is_a];
    let currentName: string | undefined = classes[className]?.is_a;
    while (current) {
      const attr = current.attributes?.[slotName];
      if (attr) return attr.range;
      currentName = current.is_a;
      current = currentName ? classes[currentName] : undefined;
    }
    return undefined;
  }

  /** Nearest `is_a` ancestor declaring the slot, for `redefines` refs. */
  function declaringAncestor(className: string, slotName: string): string | undefined {
    let currentName: string | undefined = classes[className]?.is_a;
    while (currentName) {
      if (classes[currentName]?.attributes?.[slotName]) return currentName;
      currentName = classes[currentName]?.is_a;
    }
    return undefined;
  }

  function compileClass(className: string, spec: any): SchemaTypeModel {
    const { localName } = identityOf(className);
    const classUri: string | undefined = spec.class_uri;
    const isTrait = spec.mixin === true;

    const meta: Record<string, any> = annotationsToMeta(spec.annotations);
    if (!isTrait && classUri?.startsWith('bpmn:') && !meta.bpmnType) meta.bpmnType = classUri;

    const properties: SchemaPropertyModel[] = Object.entries(spec.attributes ?? {}).map(
      ([name, attrSpec]) => compileAttribute(name, attrSpec),
    );

    // slot_usage pins an inherited slot (e.g. CognitiveTask fixes
    // isDataOperation to false) -> redefining property with a pinned default.
    for (const [slotName, usage] of Object.entries<any>(spec.slot_usage ?? {})) {
      const range = inheritedRange(className, slotName);
      const ancestor = declaringAncestor(className, slotName);
      const pinned = usage?.equals_string !== undefined || usage?.equals_number !== undefined;
      const value = parseIfabsent(usage?.equals_string ?? usage?.equals_number ?? usage?.ifabsent);
      properties.push({
        name: slotName,
        type: mapRange(range).type,
        isAttr: true,
        ...(value !== undefined ? { default: value } : {}),
        ...(ancestor ? { redefines: `${qualifiedIdentityOf(ancestor)}#${slotName}` } : {}),
        ...(pinned ? { meta: { pinned: true } } : {}),
      });
    }

    if (isTrait) {
      if (!classUri?.startsWith('bpmn:')) {
        throw new Error(`LinkML mixin class '${className}' needs a bpmn:* class_uri to map to a trait.`);
      }
      return {
        name: localName,
        description: spec.description,
        isAbstract: true,
        extends: [classUri],
        ...(Object.keys(meta).length > 0 ? { meta } : {}),
        properties,
      };
    }

    // Wrapper inheritance: `is_a` parent, else attach below the bpmn type.
    const superClass = spec.is_a
      ? [qualifiedIdentityOf(spec.is_a)]
      : classUri?.startsWith('bpmn:') ? [classUri] : [];

    for (const mixinRef of spec.mixins ?? []) {
      if (traitNames.has(mixinRef)) continue; // applies via the BPMN BO already
      console.warn(`[linkml] '${className}' lists non-trait mixin '${mixinRef}'; not supported, skipping.`);
    }

    return {
      name: localName,
      description: spec.description,
      isAbstract: spec.abstract === true,
      superClass,
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
      properties,
    };
  }

  // --- assemble one SchemaModel per identity prefix -------------------------

  const byPrefix = new Map<string, SchemaModel>();

  function modelFor(prefix: string): SchemaModel {
    let model = byPrefix.get(prefix);
    if (!model) {
      model = {
        prefix,
        name: prefix === defaultPrefix && typeof doc.title === 'string' ? doc.name : prefix,
        uri: (prefixUris[prefix] ?? `https://example.org/${prefix}`).replace(/[/#]$/, ''),
        version: doc.version,
        description: doc.description,
        xml: { tagAlias: 'lowerCase' },
        types: [],
        enumerations: [],
      };
      byPrefix.set(prefix, model);
    }
    return model;
  }

  // Default-prefix model first so palette/menu ordering is stable.
  const defaultModel = modelFor(defaultPrefix);

  for (const [name, spec] of Object.entries<any>(valueTypes)) {
    defaultModel.types.push({
      name,
      description: spec?.description,
      superClass: ['String'],
    });
  }

  for (const [name, spec] of Object.entries<any>(enums)) {
    const literals: SchemaEnumModel['literalValues'] = Object.entries<any>(
      spec?.permissible_values ?? {},
    ).map(([value, lit]) => ({
      name: lit?.title ?? value,
      value,
      description: lit?.description,
    }));
    defaultModel.enumerations.push({
      name,
      description: spec?.description,
      isAbstract: true,
      literalValues: literals,
    });
  }

  for (const [className, spec] of Object.entries<any>(classes)) {
    const { prefix } = identityOf(className);
    modelFor(prefix).types.push(compileClass(className, spec));
  }

  return [...byPrefix.values()];
}
