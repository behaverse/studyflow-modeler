import { expect, test } from '@playwright/test';

import { buildCatalog } from '@core/notation';
import {
  MODDLE_SIMPLE_TYPES,
  isValueType,
  toModdlePackages,
  type SchemaModel,
} from '@core/notation/moddlePackage';

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
