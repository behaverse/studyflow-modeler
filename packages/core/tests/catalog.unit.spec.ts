import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { BPMN_ANCESTORS, buildCatalog } from '@core/notation';
import { connectsToFixture } from '@tests/schemas';

/** The catalog's own tables: the slice of the BPMN hierarchy it walks, and the connection rules a schema declares. */

test('BPMN_ANCESTORS lists exactly bpmn-moddle\'s ancestors among the types it knows', () => {
  const moddle = new BpmnModdle() as any;
  for (const [type, ancestors] of Object.entries(BPMN_ANCESTORS)) {
    const known = moddle.getType(type).$descriptor.allTypes
      .map((ancestor: any) => ancestor.name)
      .filter((name: string) => name !== type && name in BPMN_ANCESTORS);
    expect([...ancestors].sort(), type).toEqual(known.sort());
  }
});

test('connectionRule: a source\'s connectsTo list decides, a bpmn:* entry admits its subtypes, and a source without one defers', () => {
  const catalog = buildCatalog([connectsToFixture()]);
  const CASES: Array<[string | undefined, string, boolean | 'defer']> = [
    // Consent lists lab:Survey and bpmn:Gateway.
    ['lab:Consent', 'lab:Survey', true],
    ['lab:Consent', 'bpmn:ExclusiveGateway', true],
    ['lab:Consent', 'lab:Debrief', false],
    ['lab:Consent', 'bpmn:EndEvent', false],
    // Debrief lists '*'.
    ['lab:Debrief', 'lab:Consent', true],
    ['lab:Debrief', 'bpmn:EndEvent', true],
    // Survey and BPMN's own types list nothing.
    ['lab:Survey', 'lab:Consent', 'defer'],
    ['bpmn:Task', 'bpmn:Task', 'defer'],
    [undefined, 'lab:Survey', 'defer'],
  ];
  for (const [source, target, expected] of CASES) {
    expect(catalog.connectionRule(source, target), `${source} -> ${target}`).toBe(expected);
  }
});
