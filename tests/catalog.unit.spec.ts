import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, BPMN_ANCESTORS, isBpmnSubtypeOf } from '../src/core/catalog';
import { CORE_PREFIXES, SCHEMAS } from '../src/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/core/schema';

/**
 * Cross-validates the compiled TypeCatalog against bpmn-moddle.
 *
 * The app reads all schema metadata from the catalog (plain data compiled
 * from the YAML); moddle only reads and writes the XML. These tests keep moddle as
 * the oracle so the catalog's static view can never drift from what moddle
 * actually serializes: attribute sets, types, defaults, inheritance,
 * `extends` traits, and the static BPMN ancestor table.
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');

const models = SCHEMAS.map(({ prefix }) =>
  fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
);

// Production pipeline: SchemaModel -> catalog for the app, SchemaModel -> packages
// for moddle. The two never share objects (moddle mutates its
// packages in place).
const catalog = buildCatalog(models);
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const moddle = new BpmnModdle(packages) as any;

const PRIMITIVE_TYPES = new Set(['String', 'Boolean', 'Integer', 'Real', 'Element']);

/** Qualified names of value types (String subtypes) across all schemas. */
const VALUE_TYPES = new Set(
  models.flatMap((model) =>
    model.types
      .filter((t) => (t.superClass ?? []).some((sc) => PRIMITIVE_TYPES.has(sc)))
      .map((t) => `${model.prefix}:${t.name}`),
  ),
);

function isExtensionPrefix(prefix: string | undefined): boolean {
  return !!prefix && !CORE_PREFIXES.has(prefix);
}

/** Concrete, standalone-instantiable schema types (same filter the app uses). */
function concreteTypes(prefix: string): any[] {
  return (packages[prefix].types ?? []).filter(
    (t: any) =>
      !t.extends
      && !t.isAbstract
      && !(t.superClass ?? []).some((s: string) => PRIMITIVE_TYPES.has(s)),
  );
}

// ---------------------------------------------------------------------------
// Legacy oracles: the moddle-reflection algorithms the catalog replaced.
// Keep them byte-for-byte equivalent to the pre-catalog implementations so
// behavior parity is checked, not just self-consistency.
// ---------------------------------------------------------------------------

const PRIMITIVE_SUPER_CLASSES = new Set(['Element', 'BaseElement', 'String', 'Boolean', 'Integer', 'Float', 'Double']);

function legacyResolveBpmnCreateType(typeRefOrSchema: any): string | null {
  const typeDef = typeof typeRefOrSchema === 'string' ? legacyResolveTypeSchema(typeRefOrSchema) : typeRefOrSchema;
  if (!typeDef) return null;
  return legacyWalk(typeDef, new Set<string>());
}

function legacyWalk(typeDef: any, seen: Set<string>): string | null {
  const id = typeDef?.ns?.name || typeDef?.name || String(typeDef);
  if (seen.has(id)) return null;
  seen.add(id);

  const metaBpmn = typeDef?.meta?.bpmnType;
  if (typeof metaBpmn === 'string' && metaBpmn.startsWith('bpmn:')) return metaBpmn;

  for (const extended of typeDef.extends ?? []) {
    if (typeof extended === 'string' && extended.startsWith('bpmn:')) return extended;
    const extendedSchema = legacyResolveTypeSchema(extended, typeDef.ns?.prefix);
    if (!extendedSchema) continue;
    const resolved = legacyWalk(extendedSchema, seen);
    if (resolved) return resolved;
  }

  if (typeDef.ns?.prefix === 'bpmn' && typeDef.name) return `bpmn:${typeDef.name}`;

  for (const superType of typeDef.superClass ?? []) {
    const localName = superType.includes(':') ? superType.split(':')[1] : superType;
    if (PRIMITIVE_SUPER_CLASSES.has(localName)) continue;
    if (typeof superType === 'string' && superType.startsWith('bpmn:')) return superType;

    const parentSchema = legacyResolveTypeSchema(superType, typeDef.ns?.prefix);
    if (!parentSchema) continue;
    const resolved = legacyWalk(parentSchema, seen);
    if (resolved) return resolved;
  }

  return null;
}

function legacyResolveTypeSchema(typeRef: string, ownerPrefix?: string): any {
  const typeMap: Record<string, any> = moddle?.registry?.typeMap ?? {};
  const localName = typeRef.includes(':') ? typeRef.split(':')[1] : typeRef;
  const candidates = [
    typeRef,
    ownerPrefix && !typeRef.includes(':') ? `${ownerPrefix}:${typeRef}` : null,
    !typeRef.startsWith('bpmn:') ? `bpmn:${localName}` : null,
    localName,
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    if (typeMap[candidate]) return typeMap[candidate];
  }
  for (const candidate of candidates) {
    try { return moddle.getTypeDescriptor(candidate); } catch { /* try next */ }
  }
  return null;
}

/**
 * Defaults oracle: the extension-prefixed defaults moddle itself reports on
 * the type's effective descriptor. (The pre-catalog `getDefaults` walker is
 * not used as the oracle: it dropped same-package unqualified `superClass`
 * refs and redundantly collected BPMN-native defaults that moddle applies on
 * instantiation anyway.)
 */
function moddleExtensionDefaults(typeName: string): Record<string, any> {
  let descriptor: any;
  try { descriptor = moddle.registry.getEffectiveDescriptor(typeName); } catch { return {}; }
  const defaults: Record<string, any> = {};
  for (const p of descriptor?.properties ?? []) {
    if (p.default !== undefined && isExtensionPrefix(p.ns?.prefix)) defaults[p.ns.name] = p.default;
  }
  return defaults;
}

// ---------------------------------------------------------------------------
// Static BPMN table
// ---------------------------------------------------------------------------

test.describe('catalog: static BPMN ancestor table', () => {
  test('every listed ancestor is real according to bpmn-moddle', () => {
    for (const [type, ancestors] of Object.entries(BPMN_ANCESTORS)) {
      const descriptor = moddle.getType(type)?.$descriptor;
      expect(descriptor, `${type} exists in bpmn-moddle`).toBeTruthy();
      const allTypes = new Set((descriptor.allTypes ?? []).map((t: any) => t.name));
      for (const ancestor of ancestors) {
        expect(allTypes.has(ancestor), `${type} -> ${ancestor}`).toBe(true);
      }
    }
  });

  test('category-relevant subtype checks agree with bpmn-moddle', () => {
    const relevant = [
      'bpmn:Event', 'bpmn:Gateway', 'bpmn:SubProcess', 'bpmn:Participant', 'bpmn:Group',
      'bpmn:Activity', 'bpmn:DataObjectReference', 'bpmn:DataStoreReference',
      'bpmn:ItemAwareElement', 'bpmn:BaseElement',
    ];
    for (const type of Object.keys(BPMN_ANCESTORS)) {
      const allTypes = new Set(
        (moddle.getType(type)?.$descriptor?.allTypes ?? []).map((t: any) => t.name),
      );
      for (const ancestor of relevant) {
        expect(
          isBpmnSubtypeOf(type, ancestor),
          `${type} subtype-of ${ancestor}`,
        ).toBe(allTypes.has(ancestor));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Type-level parity
// ---------------------------------------------------------------------------

test.describe('catalog: type parity with moddle', () => {
  for (const { prefix } of SCHEMAS) {
    test(`${prefix}: bpmnType resolution matches the legacy walker`, () => {
      for (const t of packages[prefix].types ?? []) {
        const qname = `${prefix}:${t.name}`;
        const legacy = legacyResolveBpmnCreateType(moddle.registry.typeMap[qname]);
        expect(catalog.bpmnTypeOf(qname), qname).toBe(legacy);
      }
    });

    test(`${prefix}: defaults match moddle effective descriptors`, () => {
      for (const t of concreteTypes(prefix)) {
        const qname = `${prefix}:${t.name}`;
        expect(catalog.defaultsOf(qname), qname).toEqual(moddleExtensionDefaults(qname));
      }
    });

    test(`${prefix}: instance attributes match moddle effective descriptors`, () => {
      for (const t of concreteTypes(prefix)) {
        const qname = `${prefix}:${t.name}`;
        const descriptor = moddle.getElementDescriptor(moddle.create(qname));

        const moddleExtension = new Map<string, any>(
          (descriptor.properties ?? [])
            .filter((p: any) => isExtensionPrefix(p.ns?.prefix))
            .map((p: any) => [p.ns.name, p]),
        );
        const catalogSpecs = new Map(
          catalog.instanceAttributesOf(qname).map((spec) => [spec.ns.name, spec]),
        );

        expect([...catalogSpecs.keys()].sort(), `${qname} attribute set`).toEqual(
          [...moddleExtension.keys()].sort(),
        );

        for (const [name, spec] of catalogSpecs) {
          const desc = moddleExtension.get(name);
          // Value types (String subtypes) go on the wire as plain String for
          // non-attr properties (see toModdlePackages); the catalog keeps the
          // authored type as the UI hint.
          const wireString = desc.type === 'String' && VALUE_TYPES.has(spec.type);
          if (!wireString) expect(spec.type, `${qname}#${name} type`).toBe(desc.type);
          expect(spec.default, `${qname}#${name} default`).toEqual(desc.default);
          expect(!!spec.isMany, `${qname}#${name} isMany`).toBe(!!desc.isMany);
          expect(!!spec.isBody, `${qname}#${name} isBody`).toBe(!!desc.isBody);
        }
      }
    });

    test(`${prefix}: body-wrapper resolution matches moddle`, () => {
      for (const entry of catalog.schemaFor(prefix)?.types ?? []) {
        for (const spec of entry.attributes) {
          if (!spec.bodyProp) continue;
          const descriptor = moddle.registry.getEffectiveDescriptor(spec.type);
          const bodyDesc = (descriptor.properties ?? []).find((p: any) => p.isBody);
          expect(bodyDesc?.name, `${entry.name}#${spec.name} bodyProp`).toBe(spec.bodyProp);
          // A value-typed body goes on the wire as `String` (so moddle escapes
          // its markup), with the authored type preserved in `valueType`.
          const bodyType = bodyDesc?.valueType ?? bodyDesc?.type;
          expect(bodyType, `${entry.name}#${spec.name} bodyType`).toBe(spec.bodyType);
        }
      }
    });
  }

  test('trait mixins match moddle effective descriptors of BPMN targets', () => {
    const targets = [
      'bpmn:Task', 'bpmn:UserTask', 'bpmn:ServiceTask', 'bpmn:SubProcess', 'bpmn:CallActivity',
      'bpmn:StartEvent', 'bpmn:EndEvent', 'bpmn:IntermediateThrowEvent', 'bpmn:BoundaryEvent',
      'bpmn:ExclusiveGateway', 'bpmn:ParallelGateway', 'bpmn:SequenceFlow', 'bpmn:Process',
      'bpmn:DataObjectReference', 'bpmn:DataStoreReference', 'bpmn:Participant', 'bpmn:Group',
      'bpmn:TextAnnotation',
    ];
    for (const target of targets) {
      const descriptor = moddle.registry.getEffectiveDescriptor(target);
      const moddleNames = (descriptor.properties ?? [])
        .filter((p: any) => isExtensionPrefix(p.ns?.prefix))
        .map((p: any) => p.ns.name)
        .sort();
      const catalogNames = catalog.traitAttributesOf(target).map((spec) => spec.ns.name).sort();
      expect(catalogNames, `${target} mixins`).toEqual(moddleNames);
    }
  });
});

// ---------------------------------------------------------------------------
// Templates and enums
// ---------------------------------------------------------------------------

test.describe('catalog: templates and enums', () => {
  test('every schema template compiles with a resolvable type', () => {
    for (const { prefix } of SCHEMAS) {
      const declared = (packages[prefix].templates ?? []).filter((t: any) => t?.object?.type);
      const implicit = (packages[prefix].types ?? []).filter(
        (t: any) => !t.isAbstract && (t.meta?.flowElements?.length ?? 0) > 0,
      );
      const compiled = catalog.schemaFor(prefix)?.templates ?? [];
      expect(compiled.length, `${prefix} template count`).toBe(declared.length + implicit.length);

      for (const template of compiled) {
        expect(template.bpmnType, template.id).toMatch(/^bpmn:/);
        expect(catalog.getType(template.extensionType), template.id).toBeTruthy();
        for (const el of template.flowElements ?? []) {
          if (el.kind === 'node') expect(el.bpmnType, `${template.id} node`).toMatch(/^bpmn:/);
        }
      }
    }
  });

  test('enumerations carry their literals', () => {
    for (const { prefix } of SCHEMAS) {
      for (const e of packages[prefix].enumerations ?? []) {
        const entry = catalog.enumOf(`${prefix}:${e.name}`);
        expect(entry, `${prefix}:${e.name}`).toBeTruthy();
        expect(entry!.literals.map((l) => l.value)).toEqual(
          (e.literalValues ?? []).map((l: any) => l.value),
        );
      }
    }
  });
});

test.describe('catalog: runner semantics', () => {
  // The runner Session picks a random outgoing branch for any type declaring
  // `meta: {branching: random}` (see src/runner/session.ts). Pin the two
  // gateway types that rely on it so the schema contract cannot regress.
  test('allocation gateways declare random branching', () => {
    for (const name of ['cognitive:RandomGateway', 'cognitive:StratifiedAllocationGateway']) {
      expect(catalog.getType(name)?.meta?.branching, name).toBe('random');
    }
  });

  // Every branching mode a schema declares must be one the Session has an arm
  // for: `random` picks a seeded branch, `condition` evaluates the outgoing
  // conditionExpressions, and `model` is refused outright. A mode the Session
  // has never heard of would fall through to the condition arm and silently
  // take the default branch, so the set is pinned here.
  test('gateways only declare branching modes the runner implements', () => {
    for (const entry of catalog.allTypes()) {
      if (entry.meta?.branching === undefined) continue;
      expect(['random', 'condition', 'model'], `${entry.name} meta.branching`).toContain(entry.meta.branching);
    }
  });
});

test.describe('catalog: renderer semantics', () => {
  // The event renderer draws an overlay icon for any instance attribute that
  // declares `meta.icon` and has a value (see src/modeler/render/events.ts).
  // Pin the two attributes that rely on it so the schema contract cannot regress.
  test('event overlay attributes declare their icons', () => {
    const cases = [
      { bpmnType: 'bpmn:StartEvent', attr: 'consentFormUri' },
      { bpmnType: 'bpmn:EndEvent', attr: 'redirectTo' },
    ];
    for (const { bpmnType, attr } of cases) {
      const spec = catalog.instanceAttributesOf(bpmnType).find((a) => a.name === attr);
      expect(spec, `${bpmnType}#${attr}`).toBeTruthy();
      expect(typeof spec!.meta?.icon, `${bpmnType}#${attr} meta.icon`).toBe('string');
    }
  });
});
