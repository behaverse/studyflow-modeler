import { expect, test } from '@playwright/test';

import type { RunEvent } from '@core/engine';
import { provOf } from '@runtime-local/w3c';

/** A run's record as W3C PROV-O: the run, its steps and what it wrote, in PROV's own terms. */

const at = (second: number): string => `2026-10-01T10:00:0${second}.000Z`;
const stamp = { action: 'executed', who: 'ada', with: 'studyflow-cli/1.0', run: 'r1', seed: 7, plan: 'sha256:abc' };
const EVENTS: RunEvent[] = [
  { event: 'started', at: at(0), run: 'r1', state: {}, stamp },
  { event: 'wrote', at: at(1), scope: 'S', name: 'arm', value: 'fast' },
  { event: 'executed', at: at(2), id: 'Screen', entry: { node: 'Screen', name: 'Screening', type: 'bpmn:Task', startedAt: at(1), status: 'ok' } },
  { event: 'executed', at: at(3), id: 'Gate', flow: 'F_Yes', entry: { node: 'Gate', name: 'Eligible?', type: 'bpmn:ExclusiveGateway', startedAt: at(3), status: 'ok' } },
  { event: 'sent', at: at(4), message: { id: 'm1', flow: 'MF_Ask', content: { q: 'ready?' } } },
  { event: 'created', at: at(5), id: 'Figure', uri: 'results/figure.png' },
  { event: 'finished', at: at(6), status: 'ok' },
];

test('a run is a PROV activity under its study as plan, and each step one of its own under its element', () => {
  const turtle = provOf(EVENTS);
  const run = '<urn:studyflow:run:r1:2026-10-01T10:00:00.000Z>';
  expect(turtle).toContain('@prefix prov: <http://www.w3.org/ns/prov#> .');
  expect(turtle).toContain(`${run} a prov:Activity ;`);
  expect(turtle).toContain('prov:hadPlan <urn:studyflow:plan:sha256:abc> ]');
  expect(turtle).toContain('<urn:studyflow:agent:ada> a prov:Agent, prov:Person ;');
  expect(turtle).toContain('<urn:studyflow:agent:studyflow-cli/1.0> a prov:Agent, prov:SoftwareAgent ;');
  expect(turtle).toContain(`${run} prov:endedAtTime "${at(6)}"^^xsd:dateTime ;\n  sf:status "ok" .`);
  // A step: part of the run, its element as plan, its times; a gateway's step says which flow it took.
  expect(turtle).toMatch(new RegExp(`a prov:Activity ;\\n  rdfs:label "Screening" ;\\n  dcterms:isPartOf ${run.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ;\\n  prov:qualifiedAssociation \\[ a prov:Association ; prov:hadPlan <urn:studyflow:plan:sha256:abc#Screen> \\] ;`));
  expect(turtle).toContain(`prov:startedAtTime "${at(1)}"^^xsd:dateTime ;`);
  expect(turtle).toContain('sf:took <urn:studyflow:plan:sha256:abc#F_Yes> .');
  // What the run wrote, sent and made: entities it generated.
  expect(turtle).toContain('rdfs:label "arm" ;\n  sf:property <urn:studyflow:plan:sha256:abc#S> ;\n  prov:value "fast" ;');
  expect(turtle).toContain('prov:value "{\\"q\\":\\"ready?\\"}" ;');
  expect(turtle).toContain(`${run.slice(0, -1)}/file/results/figure.png> prov:wasGeneratedBy ${run} ;`);
  expect(turtle).toContain('sf:seed 7 .');
});
