import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { BPMN_ANCESTORS, buildCatalog } from '@core/notation';
import { fromModdleYaml } from '@core/notation/moddlePackage';
import { connectsToFixture } from '@tests/schemas';

/** The catalog's own tables: the slice of the BPMN hierarchy it walks, what a type inherits, and the connection rules a schema declares. */

/** Two small schemas, the second building on the first. */
const CORE = fromModdleYaml(`
name: Core
prefix: core
uri: http://example.test/core
enumerations:
  - { name: Format, literalValues: [{ name: CSV, value: csv }, { name: tsv, value: tsv }] }
types:
  - { name: Markdown, superClass: [String], meta: { editor: markdown } }
  - name: Table
    superClass: [bpmn:DataObjectReference]
    meta: { roles: [signal] }
    properties:
      - { name: name, isAttr: true, type: String }
      - { name: rows, isAttr: true, type: Integer, default: 3 }
      - { name: format, isAttr: true, type: Format, default: csv }
      - { name: notes, type: Markdown }
  - name: Flow
    extends: [bpmn:SequenceFlow, bpmn:Activity]
    isAbstract: true
    properties:
      - { name: bpmn:conditionExpression, type: bpmn:Expression, redefines: bpmn:SequenceFlow#conditionExpression }
  - name: Holder
    properties:
      - { name: value, isBody: true, type: Markdown }
`);

const SKILL = fromModdleYaml(`
name: Skill
prefix: skill
uri: http://example.test/skill
enumerations:
  - { extends: core:Format, literalValues: [{ name: Parquet, value: parquet }] }
types:
  - name: Recording
    superClass: [core:Table]
    properties:
      - { name: live, isAttr: true, type: Boolean, default: true }
      - { name: name, isAttr: true, type: String, redefines: core:Table#name }
      - { name: config, type: core:Holder }
`);

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

test('a subclass inherits its parent\'s attach point, attributes, defaults and roles; data-element follows from the attach point', () => {
  const catalog = buildCatalog([CORE, SKILL]);
  const recording = catalog.getType('skill:Recording')!;
  expect(recording.bpmnType).toBe('bpmn:DataObjectReference');
  expect(recording.attributes.map((spec) => spec.ns.name), 'the redefined name in its parent\'s place').toEqual([
    'skill:name', 'core:rows', 'core:format', 'core:notes', 'skill:live', 'skill:config',
  ]);
  expect(recording.defaults).toEqual({ 'core:rows': 3, 'core:format': 'csv', 'skill:live': true });
  expect(recording.roles, 'data-element from bpmn:DataObjectReference, signal from Table').toEqual(['data-element', 'signal']);
  expect(catalog.getType('core:Holder')!.roles, 'no attach point, no data-element').toEqual([]);
});

test('a trait reaches every subtype of its BPMN types, an enum extension appends values, and a value type\'s editor reaches its attributes', () => {
  const catalog = buildCatalog([CORE, SKILL]);
  expect(catalog.instanceAttributesOf('bpmn:UserTask').map((spec) => spec.ns.name), 'a bpmn:Activity').toEqual(['bpmn:conditionExpression']);
  expect(catalog.instanceAttributesOf('bpmn:StartEvent'), 'not one').toEqual([]);
  expect(catalog.enumOf('core:Format')!.literals.map((literal) => literal.value)).toEqual(['csv', 'tsv', 'parquet']);
  expect(catalog.attributeOf('core:Table', 'notes')!.typeEditor, 'typed Markdown').toBe('markdown');
  expect(catalog.attributeOf('skill:Recording', 'config'), 'typed Holder, whose body is Markdown').toMatchObject({
    bodyProp: 'value', bodyType: 'core:Markdown', typeEditor: 'markdown',
  });
});
