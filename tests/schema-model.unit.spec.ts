import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog } from '@core/notation';
import { fromLinkml, parseLinkml } from '@core/notation/linkml';
import { toModdlePackages } from '@core/notation/schemaFile';
import { connectsToFixture, loadSchemaModels } from './schemas';

/** The moddle package format is an *output* of the schema model, not the source format. */

test.describe('schema model: moddle package generation', () => {
  const models = loadSchemaModels();

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

  test('an enum-typed list rides as String and round-trips through XML', async () => {
    const byPrefix = Object.fromEntries(models.map((m) => [m.prefix, toModdlePackages(m, models)]));
    const streams = byPrefix.reachy.types.find((t: any) => t.name === 'InteractionRecording')
      .properties.find((p: any) => p.name === 'streams');
    expect(streams.type).toBe('String');
    expect(streams.valueType).toBe('reachy:StreamEnum');

    const moddle = new BpmnModdle(structuredClone(byPrefix)) as any;
    const recording = moddle.create('reachy:InteractionRecording', { id: 'Rec', streams: ['video', 'motion'] });
    const { xml } = await moddle.toXML(recording, { format: true });
    const { rootElement } = await moddle.fromXML(xml, 'reachy:InteractionRecording');
    expect(rootElement.streams).toEqual(['video', 'motion']);
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
  // No shipped schema declares a `connectsTo` annotation, so the fixture file carries it.
  const catalog = buildCatalog([connectsToFixture()]);

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
id: https://example.test/broken
name: broken
classes:
  DanglingSuper:
    is_a: NoSuchType
  DanglingTrait:
    mixin: true
    implements: [bpmn:Task]
    attributes:
      ok: {}
`;

  test('an unresolvable is_a ref is reported, not skipped', () => {
    const catalog = buildCatalog(fromLinkml([parseLinkml(BROKEN, 'broken.linkml.yaml')]));
    expect(catalog.diagnostics.length, 'expected at least one diagnostic').toBeGreaterThan(0);
    const joined = catalog.diagnostics.join('\n');
    expect(joined).toContain('DanglingSuper');
    expect(joined).toContain('NoSuchType');
  });

  test('a well-formed schema reports nothing', () => {
    expect(buildCatalog([connectsToFixture()]).diagnostics).toEqual([]);
  });
});
