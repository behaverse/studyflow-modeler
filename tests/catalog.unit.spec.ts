
import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, BPMN_ANCESTORS, isBpmnSubtypeOf } from '@core/notation';
import { NON_BPMN_SUPER_CLASSES } from '@core/notation/query';
import { inferRoles } from '@core/notation/compile';
import { NON_EXTENSION_PREFIXES } from '@core/constants';
import { MODDLE_SIMPLE_TYPES, toModdlePackages } from '@core/notation/schemaFile';
import { SCHEMAS, loadSchemaModels } from './schemas';

/** Cross-validates the compiled TypeCatalog against bpmn-moddle. */


const models = loadSchemaModels();

// Catalog and moddle packages are built separately; they never share objects (moddle mutates in place).
const catalog = buildCatalog(models);
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const moddle = new BpmnModdle(packages) as any;

const VALUE_TYPES = new Set(
  models.flatMap((model) =>
    model.types
      .filter((t) => (t.superClass ?? []).some((sc) => MODDLE_SIMPLE_TYPES.has(sc)))
      .map((t) => `${model.prefix}:${t.name}`),
  ),
);

function isExtensionPrefix(prefix: string | undefined): boolean {
  return !!prefix && !NON_EXTENSION_PREFIXES.has(prefix);
}

function concreteTypes(prefix: string): any[] {
  const model = models.find((m) => m.prefix === prefix)!;
  return model.types.filter(
    (t) => !t.extends && !t.isAbstract && !VALUE_TYPES.has(`${prefix}:${t.name}`),
  );
}

// Legacy oracles: verbatim ports of the pre-catalog moddle-reflection algorithms, kept as a migration net.
const PRIMITIVE_SUPER_CLASSES = NON_BPMN_SUPER_CLASSES;

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

function moddleExtensionDefaults(typeName: string): Record<string, any> {
  let descriptor: any;
  try { descriptor = moddle.registry.getEffectiveDescriptor(typeName); } catch { return {}; }
  const defaults: Record<string, any> = {};
  for (const p of descriptor?.properties ?? []) {
    if (p.default !== undefined && isExtensionPrefix(p.ns?.prefix)) defaults[p.ns.name] = p.default;
  }
  return defaults;
}

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
          catalog.instanceAttributesOf(qname)
            .filter((spec) => isExtensionPrefix(spec.ns.prefix))
            .map((spec) => [spec.ns.name, spec]),
        );

        expect([...catalogSpecs.keys()].sort(), `${qname} attribute set`).toEqual(
          [...moddleExtension.keys()].sort(),
        );

        for (const [name, spec] of catalogSpecs) {
          const desc = moddleExtension.get(name);
          // Value types serialize as plain String (see toModdlePackages); the catalog keeps the authored type.
          const associationString = desc.type === 'String' && VALUE_TYPES.has(spec.type);
          if (!associationString) expect(spec.type, `${qname}#${name} type`).toBe(desc.type);
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
      const catalogNames = catalog.instanceAttributesOf(target)
        .filter((spec) => isExtensionPrefix(spec.ns.prefix))
        .map((spec) => spec.ns.name).sort();
      expect(catalogNames, `${target} mixins`).toEqual(moddleNames);
    }
  });
});


test.describe('catalog: templates and enums', () => {
  test('every schema template compiles with a resolvable type', () => {
    for (const { prefix } of SCHEMAS) {
      const declared = (packages[prefix].templates ?? []).filter((t: any) => t?.object?.type);
      const compiled = catalog.schemaFor(prefix)?.templates ?? [];
      expect(compiled.length, `${prefix} template count`).toBe(declared.length);

      for (const template of compiled) {
        expect(template.bpmnType, template.id).toMatch(/^bpmn:/);
        if (template.extensionType !== undefined) {
          expect(catalog.getType(template.extensionType), template.id).toBeTruthy();
        }
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
  // The runner Session randomizes branches for types declaring `meta.branching: random` (src/runner/session.ts).
  test('allocation gateways declare random branching', () => {
    for (const name of ['cognitive:RandomGateway']) {
      expect(catalog.getType(name)?.meta?.branching, name).toBe('random');
    }
  });

  // An unimplemented mode silently takes the default branch, so the declared set is pinned to the implemented arms.
  test('gateways only declare branching modes the runner implements', () => {
    for (const entry of catalog.allTypes()) {
      if (entry.meta?.branching === undefined) continue;
      expect(['random', 'condition', 'model'], `${entry.name} meta.branching`).toContain(entry.meta.branching);
    }
  });
});

test.describe('catalog: renderer semantics', () => {
  // The event renderer overlays an icon for any set attribute declaring `meta.icon` (src/modeler/draw/Renderer.ts).
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

test.describe('catalog: schema-declared vocabulary', () => {
  test('roles are inferred from the BPMN attach point and declared attributes', () => {
    const dataElements = new Set(catalog.typesWithRole('data-element').map((type) => type.name));
    for (const name of ['studyflow:Dataset', 'studyflow:Table', 'studyflow:Timeseries']) {
      expect(dataElements, name).toContain(name);
    }
    expect(dataElements, 'eeg:Recording specializes studyflow:Timeseries')
      .toContain('eeg:Recording');
    expect(dataElements).not.toContain('studyflow:DataCatalog');

    const instruments = new Set(catalog.typesWithRole('instrument').map((type) => type.name));
    expect(instruments).toContain('cognitive:CognitiveTask');
    expect(instruments, 'inherited from CognitiveTask').toContain('cognitive:BehaverseTask');

    for (const role of ['data-element', 'signal', 'instrument', 'acquisition']) {
      expect(catalog.typesWithRole(role).length, `no type carries "${role}"`).toBeGreaterThan(0);
    }
  });

  test('every type declaring meta.roles adds something inference misses', () => {
    for (const entry of catalog.allTypes()) {
      const declared = entry.meta?.roles;
      if (!Array.isArray(declared)) continue;
      const inferred = new Set(inferRoles(entry.bpmnType, entry.attributes));
      const added = declared.filter((role: string) => !inferred.has(role));
      expect(added, `${entry.name} declares roles it already infers`).not.toHaveLength(0);
    }
  });

  test('inspector categories come from the schemas, ordered and unique', () => {
    const categories = catalog.categories();
    const names = categories.map((c) => c.name);
    expect(new Set(names).size, 'a category is declared once').toBe(names.length);
    expect([...categories].sort((a, b) => a.order - b.order).map((c) => c.name)).toEqual(names);

    expect(names[0]).toBe('General');
    expect(names[names.length - 1]).toBe('Execution');

    expect(categories.filter((c) => c.synthetic).map((c) => c.name)).toEqual(['Execution']);

    // `Behaverse` is the one tab a non-core schema declares (cognitive); the rest come from studyflow.
    expect(names).toEqual(['General', 'Behaverse', 'Documentation', 'Gantt', 'Data', 'Execution']);
  });

  test('a value type declares the editor its attributes render with', () => {
    // `meta.editor` on `studyflow:YAMLString` reaches every attribute of the type, even through a body wrapper.
    const configurations = catalog.instanceAttributesOf('cognitive:BehaverseTask')
      .find((spec) => spec.ns.localName === 'configurations');
    expect(configurations, 'cognitive:BehaverseTask#configurations').toBeTruthy();
    expect(configurations!.typeEditor, 'resolved through the Configurations wrapper').toBe('code');
  });

});
