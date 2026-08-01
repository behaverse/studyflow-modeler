import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '../src/core/catalog';
import { studyflowToXml, xmlToStudyflow } from '../src/core/codec';
import { toModdlePackages } from '../src/core/schema';
import {
  appendTrailEntry,
  primaryRoot,
  readTrail,
  resetTrailStamping,
  stampTrailForExport,
  trailTimestamp,
} from '../src/modeler/models/provenanceTrail';
import { loadSchemaModels } from './schemas';
import { exampleXml } from './utils';

/**
 * The provenance trail: appended as `<prov:activity>` extension elements on
 * the primary root, surviving both serializations (XML and the `.studyflow`
 * YAML), and stamped once per *fact* — an export with nothing new to record
 * leaves the trail alone, which is what keeps re-rendering the shipped
 * examples byte-stable.
 */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const moddle = new BpmnModdle(packages) as any;

async function definitionsOf(xml: string): Promise<any> {
  const { rootElement } = await moddle.fromXML(xml);
  return rootElement;
}

/** Shipped examples may already carry a trail (rendering stamps them); these
 *  tests build their premises from a document that has none yet. */
function stripTrail(definitions: any): any {
  const ext = primaryRoot(definitions).extensionElements;
  if (ext) ext.values = ext.values.filter((value: any) => value.$type !== 'prov:Activity');
  return definitions;
}

test.describe('provenance trail', () => {
  test('appends an entry that survives the XML round trip', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));

    appendTrailEntry(definitions, moddle, {
      action: 'modified',
      when: '2026-07-31T09:12:04Z',
      who: 'someone@example.org',
      with: 'studyflow-modeler/26.0731',
    });

    const { xml } = await moddle.toXML(definitions, { format: true });
    expect(xml).toContain('<prov:activity');
    expect(xml).toContain('xmlns:prov="https://w3id.org/studyflow/prov"');

    const trail = readTrail(await definitionsOf(xml));
    expect(trail).toHaveLength(1);
    expect(trail[0].action).toBe('modified');
    expect(trail[0].when).toBe('2026-07-31T09:12:04Z');
    expect(trail[0].who).toBe('someone@example.org');
    expect(trail[0].with).toBe('studyflow-modeler/26.0731');
  });

  test('survives the `.studyflow.yaml` round trip', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    appendTrailEntry(definitions, moddle, {
      action: 'created',
      when: trailTimestamp(new Date('2026-07-31T10:00:00Z')),
      with: 'studyflow-modeler/26.0731',
    });
    const { xml } = await moddle.toXML(definitions, { format: true });

    const yaml = await xmlToStudyflow(xml, moddle);
    const reloaded = readTrail(await definitionsOf(await studyflowToXml(yaml, moddle)));

    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].action).toBe('created');
    // The stamp is written in the machine's own timezone, so assert the
    // instant and the offset shape rather than one fixed rendering.
    expect(Date.parse(reloaded[0].when)).toBe(Date.parse('2026-07-31T10:00:00Z'));
    expect(reloaded[0].when).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
    // Unset facts stay unset, not empty strings.
    expect(reloaded[0].who).toBeUndefined();
  });

  test('stamps once per fact, not once per download', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('drawn_loop.studyflow.png')));
    const commandStack = { _stackIdx: -1 };
    const modeler = {
      getDefinitions: () => definitions,
      get: (name: string, _strict?: boolean) =>
        ({ moddle, commandStack } as Record<string, any>)[name],
    };

    // A document with no trail owes its first export a `created` line.
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })?.action).toBe('created');
    expect(readTrail(definitions)).toHaveLength(1);

    // Exporting again without touching anything records nothing new.
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })).toBeUndefined();
    expect(readTrail(definitions)).toHaveLength(1);

    // An edit happened: the next export is a `modified` fact...
    commandStack._stackIdx = 3;
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })?.action).toBe('modified');
    expect(readTrail(definitions)).toHaveLength(2);
    // ...and only the next one.
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })).toBeUndefined();

    // Reopened (import clears the command stack): a trail-carrying document
    // that nobody edits — the example render script — is left untouched.
    resetTrailStamping(modeler);
    commandStack._stackIdx = -1;
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })).toBeUndefined();
    expect(readTrail(definitions)).toHaveLength(2);
  });

  test('reads the drawn root, and omits unset facts from the entry', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('agent_eval_pool.studyflow.png')));
    const root = primaryRoot(definitions);
    // The stamp lands on the root the DI plane draws.
    expect(root.id).toBe(definitions.diagrams[0].plane.bpmnElement.id);

    const entry = appendTrailEntry(definitions, moddle, {
      action: 'imported',
      when: '2026-07-31T11:00:00Z',
      who: undefined,
      with: 'studyflow-modeler/26.0731',
    });
    expect(entry.who).toBeUndefined();
    expect(readTrail(definitions)).toHaveLength(1);
  });
});
