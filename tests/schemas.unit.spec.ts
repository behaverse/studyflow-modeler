import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';

import { SCHEMAS } from '../src/lib/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/lib/core/schema';

/**
 * Schema design rules, checked without a browser.
 *
 * Layer 1 lints the raw `*.moddle.yaml` files: required metadata, naming
 * conventions, resolvable type references, sane defaults, valid redefines.
 *
 * Layer 2 feeds the parsed schemas through the same IR pipeline the modeler
 * uses (`fromModdleYaml` -> `toModdlePackages`) and registers them in a real bpmn-moddle
 * instance: every concrete type must instantiate, and every palette template
 * must only set properties its type actually declares.
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');

const PRIMITIVE_TYPES = new Set(['String', 'Boolean', 'Integer', 'Real', 'Element']);

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

/** A type/enum reference is resolvable if it's a primitive, bpmn-owned, local, or in another loaded schema. */
function resolves(ref: string, schema: RawSchema): boolean {
  if (PRIMITIVE_TYPES.has(ref)) return true;
  const [prefix, name] = ref.includes(':') ? ref.split(':', 2) : [schema.prefix, ref];
  if (prefix === 'bpmn') return true; // validated for real in the moddle layer
  const target = rawSchemas.get(prefix);
  return !!target && localNames(target).has(name);
}

function findType(ref: string, schema: RawSchema): RawSchema | undefined {
  const [prefix, name] = ref.includes(':') ? ref.split(':', 2) : [schema.prefix, ref];
  return rawSchemas.get(prefix)?.types?.find((t: any) => t.name === name);
}

// ---------------------------------------------------------------------------
// Layer 1: YAML lint
// ---------------------------------------------------------------------------

test.describe('schema lint', () => {
  test('prefixes and URIs are unique across schemas', () => {
    const prefixes = [...rawSchemas.values()].map((s) => s.prefix);
    const uris = [...rawSchemas.values()].map((s) => s.uri);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(new Set(uris).size).toBe(uris.length);
  });

  for (const { prefix, name: registryName } of SCHEMAS) {
    test.describe(prefix, () => {
      const schema = rawSchemas.get(prefix)!;

      test('declares required metadata matching the registry', () => {
        expect(schema.name, 'name').toBe(registryName);
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

      test('type and enumeration names are unique and PascalCase', () => {
        const names = [
          ...(schema.types ?? []).map((t: any) => t.name),
          ...(schema.enumerations ?? []).map((e: any) => e.name),
        ];
        expect(new Set(names).size, `duplicate names in ${names}`).toBe(names.length);
        for (const n of names) expect(n, 'PascalCase').toMatch(/^[A-Z][A-Za-z0-9]*$/);
      });

      test('enumerations are abstract and their literals are named', () => {
        for (const e of schema.enumerations ?? []) {
          expect(e.isAbstract, `${e.name} must be isAbstract`).toBe(true);
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
            // Strings and enum-backed simple types all serialize as strings.
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
            // bpmn-owned targets are validated against the real moddle
            // descriptors in the registration layer below.
            if (typeRef.startsWith('bpmn:')) continue;
            // The redefined property must exist somewhere up the superClass chain.
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

      test('template-scoped types are surfaced by at least one template', () => {
        const templateTypes = new Set(
          (schema.templates ?? []).map((tpl: any) => String(tpl.object?.type).replace(/^.*:/, '')),
        );
        for (const t of schema.types ?? []) {
          if (t.meta?.templateScopedType) {
            expect(templateTypes.has(t.name), `${t.name} is templateScopedType but unused`).toBe(true);
          }
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Layer 2: moddle registration
// ---------------------------------------------------------------------------

test.describe('moddle registration', () => {
  const models = SCHEMAS.map(({ prefix }) =>
    fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
  );
  const packages = Object.fromEntries(
    models.map((model) => [model.prefix, toModdlePackages(model, models)]),
  );
  const moddle = new BpmnModdle(packages) as any;

  /** Property names a moddle instance of `qname` accepts (own + inherited + extends traits). */
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
        // `extends` traits and abstract/simple types are not standalone elements.
        if (t.extends || t.isAbstract) continue;
        if ((t.superClass ?? []).some((s: string) => PRIMITIVE_TYPES.has(s))) continue;

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
      // Keys handled by the template expander itself rather than the moddle type.
      const STRUCTURAL = new Set(['type', 'icon', 'flowElements', 'x', 'y', 'id', 'sourceRef', 'targetRef']);

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
