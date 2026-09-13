import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/moddlePackage';
import { loadSchemaModels } from './schemas';

/** The moddle package format is an *output* of the schema model, not the source format. */

test.describe('schema model: moddle package generation', () => {
  const models = loadSchemaModels();

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
