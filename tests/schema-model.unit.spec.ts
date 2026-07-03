import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { buildCatalog } from '../src/lib/core/catalog';
import { SCHEMAS } from '../src/lib/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/lib/core/schema';

/**
 * Schema-model pipeline guarantees.
 *
 * The moddle package format is now an *output* of the schema model
 * (`fromModdleYaml` -> `toModdlePackages`), not the source format. These tests
 * pin two things:
 *
 * 1. Generated packages match what the pre-SchemaModel code handed to
 *    bpmn-moddle, modulo two documented data-loss fixes, so `.studyflow` XML
 *    serialization cannot change by accident.
 * 2. The schema-driven connection-rule evaluator (`meta.connectsTo`) behaves
 *    as documented, including its defer-to-BPMN default.
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');

const VALUE_TYPE_SUPER_CLASSES = new Set(['String', 'Boolean', 'Integer', 'Float', 'Double']);

/**
 * The legacy transform the app used before the SchemaModel split, kept as oracle —
 * adjusted (independently of the production code) for the two intentional
 * divergences documented on `toModdlePackages`:
 *
 * 1. Value types (String subtypes) no longer get `Element` appended.
 * 2. Non-attribute properties typed with a value type go on the wire as
 *    plain `String`. Before this, moddle silently dropped their text content
 *    on load (`inclusionCriteria`, `exclusionCriteria`, `strata`,
 *    `Checklist.items`, `Document.metadata`) — a data-loss bug.
 * 3. All flattened properties keep the authored type in `valueType` (bodies
 *    included). Before the flatten, moddle wrote a body carrying `<`/`&` raw
 *    (it only escapes bodies typed exactly `String`), producing invalid XML;
 *    the preserved type is what lets the YAML codec fold YAML-typed values.
 */
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
      if ((type.superClass ?? []).some((sc) => VALUE_TYPE_SUPER_CLASSES.has(sc))) {
        valueTypes.add(`${model.prefix}:${type.name}`);
      }
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

  test('data-loss-prone list properties go on the wire as String', () => {
    const byPrefix = Object.fromEntries(models.map((m) => [m.prefix, toModdlePackages(m, models)]));
    const propType = (pkg: any, typeName: string, propName: string) =>
      pkg.types.find((t: any) => t.name === typeName)?.properties.find((p: any) => p.name === propName)?.type;

    expect(propType(byPrefix.cognitive, 'EligibilityGateway', 'inclusionCriteria')).toBe('String');
    expect(propType(byPrefix.cognitive, 'EligibilityGateway', 'exclusionCriteria')).toBe('String');
    expect(propType(byPrefix.cognitive, 'StratifiedAllocationGateway', 'strata')).toBe('String');
    expect(propType(byPrefix.studyflow, 'Checklist', 'items')).toBe('String');
    expect(propType(byPrefix.datatrove, 'Document', 'metadata')).toBe('String');
  });

  test('value-typed bodies and values go on the wire as String, keeping the authored type', () => {
    const byPrefix = Object.fromEntries(models.map((m) => [m.prefix, toModdlePackages(m, models)]));
    const prop = (pkg: any, typeName: string, propName: string) =>
      pkg.types.find((t: any) => t.name === typeName)?.properties.find((p: any) => p.name === propName);

    // moddle only escapes a body typed exactly `String`, so the wire type is
    // flattened while `valueType` records what the YAML codec needs to fold.
    const configValue = prop(byPrefix.cognitive, 'Configurations', 'value');
    expect(configValue.type).toBe('String');
    expect(configValue.valueType).toBe('studyflow:YAMLString');

    // `with` is a value-typed YAML property (no wrapper element).
    const withProp = prop(byPrefix.studyflow, 'DataOperationActivity', 'with');
    expect(withProp.type).toBe('String');
    expect(withProp.valueType).toBe('studyflow:YAMLString');

    // Markdown bodies flatten too (they escape the same way) but must NOT fold.
    const instructions = prop(byPrefix.galea, 'Mount', 'instructions');
    expect(instructions.type).toBe('String');
    expect(instructions.valueType).toBe('studyflow:MarkdownString');
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

// ---------------------------------------------------------------------------
// Connection rules
// ---------------------------------------------------------------------------

test.describe('schema model: connection rules', () => {
  const catalog = buildCatalog([
    {
      prefix: 'lab',
      name: 'Lab',
      uri: 'https://example.org/lab',
      types: [
        {
          name: 'Consent',
          superClass: ['bpmn:Task'],
          meta: { bpmnType: 'bpmn:Task', connectsTo: ['lab:Survey', 'bpmn:Gateway'] },
        },
        {
          name: 'Survey',
          superClass: ['bpmn:Task'],
          meta: { bpmnType: 'bpmn:Task' },
        },
        {
          name: 'Debrief',
          superClass: ['bpmn:Task'],
          meta: { bpmnType: 'bpmn:Task', connectsTo: ['*'] },
        },
      ],
      enumerations: [],
    },
  ]);

  test('allows listed schema-type targets', () => {
    expect(catalog.connectionVerdict('lab:Consent', 'lab:Survey')).toBe(true);
  });

  test('allows bpmn:* targets via the BPMN hierarchy', () => {
    expect(catalog.connectionVerdict('lab:Consent', 'bpmn:ExclusiveGateway')).toBe(true);
  });

  test('rejects targets not on the allow-list', () => {
    expect(catalog.connectionVerdict('lab:Consent', 'lab:Debrief')).toBe(false);
    expect(catalog.connectionVerdict('lab:Consent', 'bpmn:EndEvent')).toBe(false);
  });

  test('wildcard allows anything', () => {
    expect(catalog.connectionVerdict('lab:Debrief', 'lab:Consent')).toBe(true);
    expect(catalog.connectionVerdict('lab:Debrief', 'bpmn:EndEvent')).toBe(true);
  });

  test('defers when the source declares no rules', () => {
    expect(catalog.connectionVerdict('lab:Survey', 'lab:Consent')).toBe('defer');
    expect(catalog.connectionVerdict('bpmn:Task', 'bpmn:Task')).toBe('defer');
    expect(catalog.connectionVerdict(undefined, 'lab:Survey')).toBe('defer');
  });
});
