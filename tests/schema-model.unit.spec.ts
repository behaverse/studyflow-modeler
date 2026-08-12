import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { buildCatalog } from '@behaverse/studyflow-core/notation';
import { fromModdleYaml, isValueType, toModdlePackages } from '@behaverse/studyflow-core/notation/schemaFile';
import { SCHEMAS } from './schemas';

/** The moddle package format is an *output* of the schema model, not the source format. */

const SCHEMA_DIR = path.join(process.cwd(), 'assets/schemas');

/** Legacy oracle: the pre-SchemaModel transform, adjusted for the divergences `toModdlePackages` documents. */
function expectedModdlePackage(yamlContent: string, valueTypes: Set<string>, prefix: string): any {
  const schema: any = yaml.load(yamlContent);
  for (const type of schema?.types ?? []) {
    const isValueType = valueTypes.has(`${prefix}:${type.name}`);
    if (!isValueType && Array.isArray(type.superClass) && type.superClass.length > 0
        && !type.superClass.includes('Element')) {
      type.superClass.push('Element');
    }
    for (const p of type.properties ?? []) {
      if (p.isAttr || typeof p.type !== 'string') continue;
      const qualified = p.type.includes(':') ? p.type : `${prefix}:${p.type}`;
      if (!valueTypes.has(qualified)) continue;
      p.valueType = qualified;
      p.type = 'String';
    }
  }
  return schema;
}

test.describe('schema model: moddle package generation', () => {
  const texts = new Map(
    SCHEMAS.map(({ prefix }) => [prefix, readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')]),
  );
  const models = [...texts.values()].map((text) => fromModdleYaml(text));
  const valueTypes = new Set<string>();
  for (const model of models) {
    for (const type of model.types) {
      if (isValueType(type)) valueTypes.add(`${model.prefix}:${type.name}`);
    }
  }

  for (const { prefix } of SCHEMAS) {
    test(`${prefix}: generated package matches the legacy transform plus documented fixes`, () => {
      const model = models.find((m) => m.prefix === prefix)!;
      const generated = toModdlePackages(model, models);
      expect(generated).toEqual(expectedModdlePackage(texts.get(prefix)!, valueTypes, prefix));
    });
  }

  test('value types stay plain String subtypes (no Element)', () => {
    const studyflow = toModdlePackages(models.find((m) => m.prefix === 'studyflow')!, models);
    for (const name of ['MarkdownString', 'YAMLString']) {
      const type = studyflow.types.find((t: any) => t.name === name);
      expect(type.superClass, name).toEqual(['String']);
    }
  });

  test('data-loss-prone list properties go on the association as String', () => {
    const byPrefix = Object.fromEntries(models.map((m) => [m.prefix, toModdlePackages(m, models)]));
    const propType = (pkg: any, typeName: string, propName: string) =>
      pkg.types.find((t: any) => t.name === typeName)?.properties.find((p: any) => p.name === propName)?.type;

    expect(propType(byPrefix.cognitive, 'EligibilityGateway', 'inclusionCriteria')).toBe('String');
    expect(propType(byPrefix.cognitive, 'EligibilityGateway', 'exclusionCriteria')).toBe('String');
    expect(propType(byPrefix.cognitive, 'RandomGateway', 'strata')).toBe('String');
  });

  test('value-typed bodies and values go on the association as String, keeping the authored type', () => {
    const byPrefix = Object.fromEntries(models.map((m) => [m.prefix, toModdlePackages(m, models)]));
    const prop = (pkg: any, typeName: string, propName: string) =>
      pkg.types.find((t: any) => t.name === typeName)?.properties.find((p: any) => p.name === propName);

    // moddle only escapes a body typed exactly `String`; `valueType` records what the YAML codec folds.
    const configValue = prop(byPrefix.cognitive, 'Configurations', 'value');
    expect(configValue.type).toBe('String');
    expect(configValue.valueType).toBe('studyflow:YAMLString');

    const withProp = prop(byPrefix.studyflow, 'Arguments', 'additionalArguments');
    expect(withProp.type).toBe('String');
    expect(withProp.valueType).toBe('studyflow:YAMLString');

    const systemPrompt = prop(byPrefix.agentic, 'Agent', 'systemPrompt');
    expect(systemPrompt.type).toBe('String');
    expect(systemPrompt.valueType).toBe('studyflow:MarkdownString');
  });

  test('generated packages are fresh objects per call (moddle mutates them)', () => {
    const model = models.find((m) => m.prefix === 'studyflow')!;
    const a = toModdlePackages(model, models);
    const b = toModdlePackages(model, models);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.types).not.toBe(b.types);
  });
});


test.describe('schema model: connection rules', () => {
  // No shipped schema declares `meta.connectsTo`, so the fixture file carries it.
  const catalog = buildCatalog([
    fromModdleYaml(
      readFileSync(path.join(process.cwd(), 'tests/fixtures/connects-to.moddle.yaml'), 'utf8'),
      'tests/fixtures/connects-to.moddle.yaml',
    ),
  ]);

  test('an authored connectsTo block survives parse and compile', () => {
    expect(catalog.getType('lab:Consent')?.meta.connectsTo).toEqual(['lab:Survey', 'bpmn:Gateway']);
    expect(catalog.getType('lab:Survey')?.meta.connectsTo).toBeUndefined();
  });

  test('allows listed schema-type targets', () => {
    expect(catalog.connectionRule('lab:Consent', 'lab:Survey')).toBe(true);
  });

  test('allows bpmn:* targets via the BPMN hierarchy', () => {
    expect(catalog.connectionRule('lab:Consent', 'bpmn:ExclusiveGateway')).toBe(true);
  });

  test('rejects targets not on the allow-list', () => {
    expect(catalog.connectionRule('lab:Consent', 'lab:Debrief')).toBe(false);
    expect(catalog.connectionRule('lab:Consent', 'bpmn:EndEvent')).toBe(false);
  });

  test('wildcard allows anything', () => {
    expect(catalog.connectionRule('lab:Debrief', 'lab:Consent')).toBe(true);
    expect(catalog.connectionRule('lab:Debrief', 'bpmn:EndEvent')).toBe(true);
  });

  test('defers when the source declares no rules', () => {
    expect(catalog.connectionRule('lab:Survey', 'lab:Consent')).toBe('defer');
    expect(catalog.connectionRule('bpmn:Task', 'bpmn:Task')).toBe('defer');
    expect(catalog.connectionRule(undefined, 'lab:Survey')).toBe('defer');
  });
});

test.describe('compiler diagnostics', () => {
  const BROKEN = `
prefix: broken
name: Broken
uri: https://example.test/broken
version: '26.0101'
xml:
  tagAlias: lowerCase
types:
  - name: DanglingSuper
    superClass:
      - NoSuchType
  - name: DanglingTrait
    extends:
      - bpmn:Task
    properties:
      - name: ok
        type: String
        isAttr: true
enumerations: []
`;

  test('an unresolvable superClass ref is reported, not skipped', () => {
    const catalog = buildCatalog([fromModdleYaml(BROKEN, 'broken.moddle.yaml')]);
    expect(catalog.diagnostics.length, 'expected at least one diagnostic').toBeGreaterThan(0);
    const joined = catalog.diagnostics.join('\n');
    expect(joined).toContain('DanglingSuper');
    expect(joined).toContain('NoSuchType');
  });

  test('a well-formed schema reports nothing', () => {
    const clean = buildCatalog([
      fromModdleYaml(
        readFileSync(path.join(process.cwd(), 'tests/fixtures/connects-to.moddle.yaml'), 'utf8'),
        'connects-to.moddle.yaml',
      ),
    ]);
    expect(clean.diagnostics).toEqual([]);
  });
});
