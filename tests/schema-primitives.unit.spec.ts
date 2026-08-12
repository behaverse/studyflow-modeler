import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog } from '@behaverse/studyflow-core/notation';
import { NON_BPMN_SUPER_CLASSES } from '@behaverse/studyflow-core/notation/query';
import {
  MODDLE_BUILTIN_TYPES,
  MODDLE_SIMPLE_TYPES,
  isValueType,
  toModdlePackages,
  type SchemaModel,
} from '@behaverse/studyflow-core/notation/schemaFile';

/** moddle's type vocabulary, pinned against moddle itself. */

/** Type names moddle leaves unqualified on a property descriptor == its built-ins. */
function typeRefsModdleLeavesBare(candidates: string[]): Set<string> {
  const pkg = {
    name: 'Probe',
    prefix: 'probe',
    uri: 'http://example.org/probe',
    xml: { tagAlias: 'lowerCase' },
    types: [{
      name: 'Probe',
      superClass: ['Element'],
      properties: candidates.map((type) => ({ name: `p${type}`, type, isAttr: true })),
    }],
    enumerations: [],
  };
  const moddle = new BpmnModdle({ probe: pkg }) as any;
  const descriptor = moddle.registry.getEffectiveDescriptor('probe:Probe');
  const bare = new Set<string>();
  for (const property of descriptor.properties ?? []) {
    if (!property.type.includes(':')) bare.add(property.type);
  }
  return bare;
}

test.describe('moddle type vocabulary', () => {
  test('MODDLE_BUILTIN_TYPES is exactly what moddle treats as built in', () => {
    // Float/Double/Decimal are the near-misses: moddle qualifies them, proving they are not built-ins.
    const candidates = [...MODDLE_BUILTIN_TYPES, 'Float', 'Double', 'Decimal'];
    expect([...typeRefsModdleLeavesBare(candidates)].sort()).toEqual([...MODDLE_BUILTIN_TYPES].sort());
  });

  test('MODDLE_SIMPLE_TYPES is exactly the built-ins moddle reads a value out of', async () => {
    // moddle's `TYPE_CONVERTERS`: the built-ins whose XML string form is coerced to a JS value.
    const pkg = {
      name: 'Probe',
      prefix: 'probe',
      uri: 'http://example.org/probe',
      xml: { tagAlias: 'lowerCase' },
      types: [{
        name: 'Probe',
        superClass: ['Element'],
        properties: [...MODDLE_BUILTIN_TYPES]
          .filter((type) => type !== 'Element')
          .map((type) => ({ name: `p${type}`, type, isAttr: true })),
      }],
      enumerations: [],
    };
    const moddle = new BpmnModdle({ probe: pkg }) as any;
    const attrs = [...MODDLE_BUILTIN_TYPES]
      .filter((type) => type !== 'Element')
      .map((type) => `p${type}="1"`)
      .join(' ');
    const { rootElement } = await moddle.fromXML(
      `<?xml version="1.0"?><probe:probe xmlns:probe="http://example.org/probe" ${attrs} />`,
      'probe:Probe',
    );

    const coerced = new Set<string>();
    for (const type of MODDLE_BUILTIN_TYPES) {
      if (type === 'Element') continue;
      if (rootElement[`p${type}`] !== '1') coerced.add(type);
    }
    coerced.add('String'); // identity converter: coercion is not observable.

    expect([...coerced].sort(), 'moddle coerces exactly the simple types')
      .toEqual([...MODDLE_SIMPLE_TYPES].sort());
    expect(MODDLE_SIMPLE_TYPES.has('Element'), 'Element is not a value').toBe(false);
    expect(MODDLE_BUILTIN_TYPES.has('Element'), 'Element is still a built-in').toBe(true);
  });

  test('no superClass naming a moddle built-in leads to a BPMN attach point', () => {
    for (const builtin of MODDLE_BUILTIN_TYPES) {
      expect(NON_BPMN_SUPER_CLASSES.has(builtin), `superClass: [${builtin}]`).toBe(true);
    }
  });
});

function probeModel(base: string): SchemaModel {
  return {
    prefix: 'probe',
    name: 'Probe',
    uri: 'http://example.org/probe',
    types: [
      { name: 'Scalar', superClass: [base], properties: [] },
      {
        name: 'Holder',
        superClass: ['bpmn:Task'],
        meta: { bpmnType: 'bpmn:Task' },
        properties: [{ name: 'held', type: 'Scalar' }],
      },
    ],
    enumerations: [],
  };
}

test.describe('value types: every detector agrees', () => {
  // A base missed by either detector skips the flatten-to-String rewrite that makes moddle escape a body.
  for (const base of MODDLE_SIMPLE_TYPES) {
    test(`superClass: [${base}] is a value type on every path`, () => {
      const model = probeModel(base);
      const scalar = model.types[0];

      expect(isValueType(scalar), 'isValueType').toBe(true);

      const pkg = toModdlePackages(model);
      expect(pkg.types[0].superClass, 'no Element appended to a value type').toEqual([base]);
      const held = pkg.types[1].properties[0];
      expect(held.type, 'flattened so moddle escapes it').toBe('String');
      expect(held.valueType, 'authored type preserved').toBe('probe:Scalar');

      const catalog = buildCatalog([model]);
      expect(catalog.getType('probe:Scalar')?.hiddenFromPalette, 'a value is not a palette item')
        .toBe(true);
      expect(catalog.getType('probe:Scalar')?.bpmnType, 'a value has no BPMN attach point')
        .toBeNull();
    });
  }

  test('superClass: [Element] makes an element, not a value', () => {
    const model = probeModel('Element');
    expect(isValueType(model.types[0]), 'Element is not a value base').toBe(false);
    const pkg = toModdlePackages(model);
    expect(pkg.types[1].properties[0].type, 'an element-typed property is not flattened')
      .toBe('Scalar');
  });
});
