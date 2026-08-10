import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';

import { bpmnSelfAndAncestors, buildCatalog } from '../src/core/notation';
import { MODDLE_BUILTIN_TYPES, MODDLE_SIMPLE_TYPES, fromModdleYaml, toModdlePackages } from '../src/core/notation/schemaFile';
import { SCHEMAS, loadSchemaModels } from './schemas';

/** Schema design rules, checked without a browser. */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');

type RawSchema = any;

const rawSchemas = new Map<string, RawSchema>(
  SCHEMAS.map(({ prefix }) => [
    prefix,
    yaml.load(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')) as RawSchema,
  ]),
);

function localNames(schema: RawSchema): Set<string> {
  return new Set([
    ...(schema.types ?? []).map((t: any) => t.name),
    ...(schema.enumerations ?? []).map((e: any) => e.name),
  ]);
}

function resolves(ref: string, schema: RawSchema): boolean {
  if (MODDLE_BUILTIN_TYPES.has(ref)) return true;
  const [prefix, name] = ref.includes(':') ? ref.split(':', 2) : [schema.prefix, ref];
  if (prefix === 'bpmn') return true; // validated for real in the moddle layer
  const target = rawSchemas.get(prefix);
  return !!target && localNames(target).has(name);
}

function findType(ref: string, schema: RawSchema): RawSchema | undefined {
  const [prefix, name] = ref.includes(':') ? ref.split(':', 2) : [schema.prefix, ref];
  return rawSchemas.get(prefix)?.types?.find((t: any) => t.name === name);
}

test.describe('schema lint', () => {
  test('prefixes and URIs are unique across schemas', () => {
    const prefixes = [...rawSchemas.values()].map((s) => s.prefix);
    const uris = [...rawSchemas.values()].map((s) => s.uri);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(new Set(uris).size).toBe(uris.length);
  });

  test('the registry is exactly the schema files, core ones first', () => {
    expect(SCHEMAS.map((s) => s.prefix).sort()).toEqual([...rawSchemas.keys()].sort());
    const cores = SCHEMAS.filter((s) => s.core);
    expect(cores.length, 'at least one core schema').toBeGreaterThan(0);
    expect(SCHEMAS.slice(0, cores.length).every((s) => s.core), 'core schemas lead').toBe(true);
    for (const entry of SCHEMAS) {
      expect(entry.name, `${entry.prefix} name`).not.toBe('');
      expect(entry.description, `${entry.prefix} blurb`).not.toBe('');
      expect(entry.description.length, `${entry.prefix} blurb fits a row`).toBeLessThan(320);
    }
  });

  for (const { prefix } of SCHEMAS) {
    test.describe(prefix, () => {
      const schema = rawSchemas.get(prefix)!;

      test('declares required metadata', () => {
        expect(typeof schema.name, 'name').toBe('string');
        expect(schema.prefix, 'prefix matches filename').toBe(prefix);
        expect(schema.prefix).toBe(schema.prefix.toLowerCase());
        expect(typeof schema.description, 'description').toBe('string');
        expect(typeof schema.uri, 'uri').toBe('string');
        expect(schema.uri).toMatch(/^https?:\/\//);
        // Check the raw literal: YAML parses 26.0610 as a float and drops the zero.
        const rawVersion = /^version:\s*['"]?([^'"\n]+)/m.exec(
          readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8'),
        )?.[1];
        expect(rawVersion, 'version is YY.MMDD').toMatch(/^\d{2}\.\d{4}$/);
        expect(schema.xml?.tagAlias, 'tagAlias').toBe('lowerCase');
      });

      test('every category an attribute names is declared by some schema', () => {
        const declared = new Set(
          [...rawSchemas.values()].flatMap((s) => (s.categories ?? []).map((c: any) => c.name)),
        );
        for (const type of schema.types ?? []) {
          for (const property of type.properties ?? []) {
            for (const category of property.meta?.categories ?? []) {
              expect(declared, `${type.name}#${property.name} files under an undeclared "${category}"`)
                .toContain(category);
            }
          }
        }
      });

      test('declared categories have unique names and orders', () => {
        const categories = schema.categories ?? [];
        const names = categories.map((c: any) => c.name);
        expect(new Set(names).size, `duplicate categories in ${names}`).toBe(names.length);
        for (const category of categories) {
          expect(typeof category.order, `${category.name} order`).toBe('number');
        }
      });

      test('type and enumeration names are unique and PascalCase', () => {
        const names = [
          ...(schema.types ?? []).map((t: any) => t.name),
          ...(schema.enumerations ?? []).map((e: any) => e.name),
        ];
        expect(new Set(names).size, `duplicate names in ${names}`).toBe(names.length);
        for (const n of names) expect(n, 'PascalCase').toMatch(/^[A-Z][A-Za-z0-9]*$/);
      });

      // No `isAbstract` assertion: `compileEnum` copies only name/description/literalValues, so it would be a no-op.
      test('enumeration literals are named', () => {
        for (const e of schema.enumerations ?? []) {
          for (const lit of e.literalValues ?? []) {
            expect(typeof lit.name, `${e.name} literal name`).toBe('string');
          }
        }
      });

      test('superClass, extends, and property type references resolve', () => {
        for (const t of schema.types ?? []) {
          for (const ref of t.superClass ?? []) {
            expect(resolves(ref, schema), `${t.name} superClass ${ref}`).toBe(true);
          }
          for (const ref of t.extends ?? []) {
            expect(ref, `${t.name} extends must target a bpmn type`).toMatch(/^bpmn:/);
          }
          for (const p of t.properties ?? []) {
            expect(typeof p.name, `${t.name} property name`).toBe('string');
            expect(typeof p.type, `${t.name}.${p.name} type`).toBe('string');
            expect(resolves(p.type, schema), `${t.name}.${p.name} type ${p.type}`).toBe(true);
          }
        }
      });

      test('no superClass restates a BPMN ancestor the type already has', () => {
        for (const t of schema.types ?? []) {
          const supers: string[] = t.superClass ?? [];
          if (supers.length < 2) continue;
          for (const ref of supers) {
            const others = supers.filter((s) => s !== ref);
            for (const other of others) {
              expect(
                bpmnSelfAndAncestors(other).includes(ref),
                `${t.name} lists superClass ${ref}, already reached through ${other}`,
              ).toBe(false);
            }
          }
        }
      });

      test('no two traits declare the same property the same way', () => {
        // Same name alone is not the signal; same name *and* type *and* tab is one property wearing two hats.
        const seen = new Map<string, string>();
        for (const t of schema.types ?? []) {
          if (!t.extends?.length) continue;
          for (const p of t.properties ?? []) {
            if (p.redefines || p.replaces) continue;
            const key = `${p.name}:${p.type}:${(p.meta?.categories ?? []).join('+')}`;
            const first = seen.get(key);
            expect(first, `${t.name}.${p.name} repeats ${first}.${p.name} verbatim`).toBeUndefined();
            seen.set(key, t.name);
          }
        }
      });

      test('property names are unique per type and defaults match their declared type', () => {
        for (const t of schema.types ?? []) {
          const propNames = (t.properties ?? []).map((p: any) => p.name);
          expect(new Set(propNames).size, `${t.name} duplicate properties`).toBe(propNames.length);

          for (const p of t.properties ?? []) {
            if (p.default === undefined) continue;
            const label = `${t.name}.${p.name} default`;
            if (p.type === 'Boolean') expect(typeof p.default, label).toBe('boolean');
            else if (p.type === 'Integer') {
              expect(Number.isInteger(p.default), label).toBe(true);
            } else if (p.type === 'Real') expect(typeof p.default, label).toBe('number');
            else expect(typeof p.default, label).toBe('string');
          }
        }
      });

      test('redefines/replaces point at an existing inherited property', () => {
        for (const t of schema.types ?? []) {
          for (const p of t.properties ?? []) {
            const ref = p.redefines ?? p.replaces;
            if (!ref) continue;
            const match = /^([^#]+)#(.+)$/.exec(ref);
            expect(match, `${t.name}.${p.name} redefines '${ref}' must be Type#property`).toBeTruthy();
            const [, typeRef, propName] = match!;
            if (typeRef.startsWith('bpmn:')) continue;
            const seen = new Set<string>();
            const declares = (typeName: string): boolean => {
              if (seen.has(typeName)) return false;
              seen.add(typeName);
              const def = findType(typeName, schema);
              if (!def) return false;
              if ((def.properties ?? []).some((q: any) => q.name === propName)) return true;
              return (def.superClass ?? []).some((s: string) => declares(s));
            };
            expect(declares(typeRef), `${t.name}.${p.name} redefines ${ref}`).toBe(true);
          }
        }
      });

      test('templates reference real types', () => {
        for (const tpl of schema.templates ?? []) {
          expect(typeof tpl.description, 'template description').toBe('string');
          const typeRef = tpl.object?.type;
          expect(typeof typeRef, 'template object.type').toBe('string');
          expect(resolves(typeRef, schema), `template type ${typeRef}`).toBe(true);
        }
      });

    });
  }
});

test.describe('moddle registration', () => {
  const models = SCHEMAS.map(({ prefix }) =>
    fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
  );
  const packages = Object.fromEntries(
    models.map((model) => [model.prefix, toModdlePackages(model, models)]),
  );
  const moddle = new BpmnModdle(packages) as any;

  function knownProperties(qname: string): Set<string> {
    const instance = moddle.create(qname);
    const descriptor = moddle.getElementDescriptor(instance);
    const names = new Set<string>();
    for (const p of descriptor.properties ?? []) {
      names.add(p.name);
      if (p.ns?.localName) names.add(p.ns.localName);
      if (p.ns?.name) names.add(p.ns.name);
    }
    return names;
  }

  for (const { prefix } of SCHEMAS) {
    const schema = rawSchemas.get(prefix)!;

    test(`${prefix}: every concrete type instantiates with its defaults`, () => {
      for (const t of schema.types ?? []) {
        if (t.extends || t.isAbstract) continue;
        if ((t.superClass ?? []).some((s: string) => MODDLE_SIMPLE_TYPES.has(s))) continue;

        const qname = `${prefix}:${t.name}`;
        const element = moddle.create(qname);
        expect(element, qname).toBeTruthy();
        expect(element.$type).toBe(qname);

        const descriptor = moddle.getElementDescriptor(element);
        for (const p of t.properties ?? []) {
          const desc = descriptor.propertiesByName[p.name];
          expect(desc, `${qname}#${p.name} registered`).toBeTruthy();
          if (p.default !== undefined && p.isAttr) {
            expect(desc.default, `${qname}#${p.name} default`).toBe(p.default);
          }
        }
      }
    });

    test(`${prefix}: redefines/replaces of bpmn properties target real descriptors`, () => {
      for (const t of schema.types ?? []) {
        for (const p of t.properties ?? []) {
          const ref: string | undefined = p.redefines ?? p.replaces;
          if (!ref || !ref.startsWith('bpmn:')) continue;
          const [typeRef, propName] = ref.split('#');
          const descriptor = moddle.registry.getEffectiveDescriptor(typeRef);
          expect(descriptor, `${t.name}.${p.name}: unknown type ${typeRef}`).toBeTruthy();
          expect(
            descriptor.propertiesByName[propName],
            `${t.name}.${p.name} redefines ${ref}: no such property`,
          ).toBeTruthy();
        }
      }
    });

    test(`${prefix}: templates only set declared properties`, () => {
      // Keys the template expander handles itself (RESERVED_TEMPLATE_KEYS in the compiler, plus flow-node keys).
      const STRUCTURAL = new Set([
        'type', 'name', 'keywords', 'icon', 'attributes', 'mixins', 'flowElements',
        'x', 'y', 'id', 'sourceRef', 'targetRef',
      ]);

      const checkObject = (obj: Record<string, any>, context: string) => {
        const typeRef = String(obj.type);
        const qname = typeRef.includes(':') ? typeRef : `${prefix}:${typeRef}`;
        const known = knownProperties(qname);
        for (const key of Object.keys(obj)) {
          if (STRUCTURAL.has(key)) continue;
          if (key.startsWith('bpmn:')) {
            expect(knownProperties('bpmn:Task').has(key.slice(5)) || key === 'bpmn:documentation',
              `${context}: unknown bpmn key ${key}`).toBe(true);
            continue;
          }
          expect(known.has(key), `${context}: '${key}' is not a property of ${qname}`).toBe(true);
        }
      };

      for (const tpl of schema.templates ?? []) {
        const label = `template '${tpl.object?.['bpmn:name'] ?? tpl.description}'`;
        checkObject(tpl.object, label);

        const children: any[] = tpl.object?.flowElements ?? [];
        const ids = new Set(children.map((c) => c.id).filter(Boolean));
        for (const child of children) {
          checkObject(child, `${label} > ${child.id ?? child.type}`);
          if (child.type === 'bpmn:SequenceFlow') {
            expect(ids.has(child.sourceRef), `${label}: dangling sourceRef ${child.sourceRef}`).toBe(true);
            expect(ids.has(child.targetRef), `${label}: dangling targetRef ${child.targetRef}`).toBe(true);
          }
        }
      }
    });
  }
});

test('the shipped schemas compile with no diagnostics', () => {
  const catalog = buildCatalog(loadSchemaModels());
  expect(catalog.diagnostics).toEqual([]);
});
