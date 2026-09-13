import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { fromModdleYaml, toModdlePackages, type SchemaModel } from '@core/notation/moddlePackage';

/** The moddle package a schema compiles to. moddle-xml writes a list, and escapes a text body, only when it is typed
 * as one of moddle's own simple types, so a value- or enum-typed one rides as `String`. */

const BASE = `
name: base
prefix: base
uri: http://example.test/base
types:
  - { name: Code, superClass: [String] }
`;

const PROBE = `
name: probe
prefix: probe
uri: http://example.test/probe
enumerations:
  - { name: Stream, literalValues: [{ name: video, value: video }, { name: motion, value: motion }] }
types:
  - { name: Text, superClass: [String] }
  - { name: Flag, superClass: [Boolean] }
  - { name: Count, superClass: [Integer] }
  - { name: Ratio, superClass: [Real] }
  - { name: Note }
  - name: Probe
    properties:
      - { name: text, type: Text }
      - { name: counts, isMany: true, type: Count }
      - { name: streams, isMany: true, type: Stream }
      - { name: code, type: base:Code }
      - { name: note, type: Note }
`;

/** Parsed afresh on each call, so no test sees another's changes. */
function models(): SchemaModel[] {
  return [fromModdleYaml(BASE), fromModdleYaml(PROBE)];
}

test('a value type keeps its simple base; a value- or enum-typed list or element rides as String, keeping the authored type', async () => {
  const [base, probe] = models();
  const pkg = toModdlePackages(probe, [base, probe]);
  const type = (name: string) => pkg.types.find((entry: any) => entry.name === name);
  for (const [name, simple] of [['Text', 'String'], ['Flag', 'Boolean'], ['Count', 'Integer'], ['Ratio', 'Real']]) {
    expect(type(name).superClass, `${name} is given no Element`).toEqual([simple]);
  }

  const CASES: Array<[string, string, string, string | undefined]> = [
    ['a value-typed element', 'text', 'String', 'probe:Text'],
    ['a value-typed list', 'counts', 'String', 'probe:Count'],
    ['an enum-typed list', 'streams', 'String', 'probe:Stream'],
    ['a value type another schema declares', 'code', 'String', 'base:Code'],
    ['an element-typed attribute is left alone', 'note', 'Note', undefined],
  ];
  for (const [label, name, wire, valueType] of CASES) {
    const property = type('Probe').properties.find((entry: any) => entry.name === name);
    expect({ type: property.type, valueType: property.valueType }, label).toEqual({ type: wire, valueType });
  }

  const moddle = new BpmnModdle({ probe: pkg }) as any;
  const { xml } = await moddle.toXML(moddle.create('probe:Probe', { streams: ['video', 'motion'] }));
  const { rootElement } = await moddle.fromXML(xml, 'probe:Probe');
  expect(rootElement.streams, 'the list, written and read back').toEqual(['video', 'motion']);
});

test('toModdlePackages leaves its input untouched, and so does moddle registering its output', () => {
  const [base, probe] = models();
  const before = structuredClone(probe);
  new BpmnModdle({ probe: toModdlePackages(probe, [base, probe]) });
  expect(probe).toEqual(before);
});
