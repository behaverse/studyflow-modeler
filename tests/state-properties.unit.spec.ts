import { expect, test } from '@playwright/test';

import { Study } from '@canvas/index.ts';
import type { Element } from '@core/model/index';
import { runUpdateStateProperties } from '@modeler/inspector/commands';
import { getPropertiesInScope, itemTypeOptions } from '@modeler/inspector/stateProperties';
import type { Editor } from '@modeler/editor/port';
import { freshMetamodel, studyModel } from './schemas';

/** State as BPMN's own declared variables. */

const HEAD = 'id: Defs\ndefinitions:\n  targetNamespace: http://bpmn.io/schema/bpmn\n';

/** A study of `body`, and the editor the state commands write through: that study, which it reaches alone. */
async function editorOver(body: string) {
  const study = await Study.open(HEAD + body, { metamodel: freshMetamodel() });
  return { study, modeler: { study } as unknown as Editor };
}

const propertiesOf = (element: Element): Element[] => (element.properties as Element[] | undefined) ?? [];

test('a scope adds properties by the next free id, and types them with one item definition per structure', async () => {
  const { study, modeler } = await editorOver(`Item_Series:
  type: ItemDefinition
  structureRef: pandas.Series
S:
  type: Process
  properties:
    Property_1: { name: kept }
`);
  const update = (command: Record<string, unknown>) => runUpdateStateProperties(modeler, { type: 'UpdateStateProperties', element: study.element('S')!, ...command } as never);
  const add = () => update({ action: 'add' });
  const retype = (propertyId: string, itemType: string) => update({ action: 'retype', propertyId, itemType });
  const typeOf = (id: string) => propertiesOf(study.element('S')!).find((p) => p.id === id)!.itemSubjectRef;

  add();
  add();
  expect(propertiesOf(study.element('S')!).map((p) => p.id), 'Property_1 is taken').toEqual(['Property_1', 'Property_2', 'Property_3']);

  retype('Property_2', 'string');
  retype('Property_3', 'string');
  expect(typeOf('Property_2'), 'a new structure gets an item definition').toBe('ItemDefinition_string');
  expect(typeOf('Property_3'), 'the same structure shares it').toBe(typeOf('Property_2'));
  retype('Property_1', 'pandas.Series');
  expect(typeOf('Property_1'), 'a structure the file declares keeps its item definition').toBe('Item_Series');
  retype('Property_2', 'dict[str, int]');
  expect(typeOf('Property_2'), 'a type is free text; its id keeps the NCName characters').toBe('ItemDefinition_dict_str__int_');
  retype('Property_3', '');
  expect(typeOf('Property_3'), 'untyped').toBeUndefined();

  // The type field suggests the built-in types, then the file's own, each once.
  const options = itemTypeOptions(study.model);
  expect(options.slice(-2)).toEqual(['dict[str, int]', 'pandas.Series']);
  expect(options.filter((type) => type === 'string')).toHaveLength(1);
});

test('a step may bind what its scopes declare, outward, an inner name hiding an outer one, and nothing a sibling declares', () => {
  const model = studyModel(`${HEAD}Study:
  type: Process
  properties:
    Study_n: { name: n }
    Study_arm: { name: arm }
  flowElements:
    Loop:
      type: SubProcess
      properties:
        Loop_n: { name: n }
      flowElements:
        Step: { type: Task }
    Prepare:
      type: SubProcess
      properties:
        Prepare_features: { name: features }
`);

  expect(getPropertiesInScope(model, model.get('Step')!).map((p) => `${p.name} from ${p.ownerId}`)).toEqual(['n from Loop', 'arm from Study']);
});

test.describe('property names', () => {
  test('a rename to a `_`-prefixed name is refused; the previous name stays', async () => {
    const { study, modeler } = await editorOver('S:\n  type: Process\n  properties:\n    P1: { name: count }\n');
    const rename = (name: string) => runUpdateStateProperties(modeler, { type: 'UpdateStateProperties', element: study.element('S')!, action: 'rename', propertyId: 'P1', name });

    rename('_prov');
    expect(study.element('P1')!.name).toBe('count');

    rename('total');
    expect(study.element('P1')!.name).toBe('total');
  });

  test('a new property takes an id no other scope holds', async () => {
    // Two `Property_1` in one file: the YAML keys elements by id, so saving, or an undo, kept only one of them.
    const { study, modeler } = await editorOver(`S:
  type: Process
  properties:
    Property_1: { name: count }
  flowElements:
    Battery: { type: SubProcess }
`);

    runUpdateStateProperties(modeler, { type: 'UpdateStateProperties', element: study.element('Battery')!, action: 'add' });
    expect(propertiesOf(study.element('Battery')!).map((p) => p.id)).toEqual(['Property_2']);
  });
});
