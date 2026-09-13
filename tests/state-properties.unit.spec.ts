import { expect, test } from '@playwright/test';

import { IdGenerator } from '@canvas/index.ts';
import { runUpdateStateProperties } from '@modeler/inspector/commands';
import { getPropertiesInScope, itemTypeOptions } from '@modeler/inspector/stateProperties';
import type { Editor } from '@modeler/editor/port';
import { freshModdle } from './schemas';

/** State as BPMN's own declared variables. */

/** The editor the state commands write through, over `root`: it claims every id it mints, as the editor's registry does. */
function editorOver(m: any, root: any): Editor {
  const ids = IdGenerator.fromDefinitions(root);
  return {
    model: {
      createBusinessObject: (type: string, props?: Record<string, unknown>) => {
        const element = m.create(type, props ?? {});
        ids.claim(element.id);
        return element;
      },
      ids: { assigned: (id: string) => ids.assigned(id) },
    },
    canvas: {
      updateModdleProperties(_el: any, target: any, props: Record<string, any>) {
        for (const [k, v] of Object.entries(props)) target.set(k, v);
      },
    },
  } as unknown as Editor;
}

test('a scope adds properties by the next free id, and types them with one item definition per structure', () => {
  const m = freshModdle();
  const kept = m.create('bpmn:Property', { id: 'Property_1', name: 'kept' });
  const series = m.create('bpmn:ItemDefinition', { id: 'Item_Series', structureRef: 'pandas.Series' });
  const process = m.create('bpmn:Process', { id: 'S', properties: [kept] });
  const definitions = m.create('bpmn:Definitions', { rootElements: [series, process] });
  kept.$parent = process;
  series.$parent = definitions;
  process.$parent = definitions;
  const element = { id: 'S', businessObject: process };
  const modeler = editorOver(m, definitions);
  const add = () => runUpdateStateProperties(modeler, { type: 'UpdateStateProperties', element, action: 'add' });
  const retype = (propertyId: string, itemType: string) =>
    runUpdateStateProperties(modeler, { type: 'UpdateStateProperties', element, action: 'retype', propertyId, itemType });
  const typeOf = (id: string) => process.properties.find((p: any) => p.id === id).itemSubjectRef;

  add();
  add();
  expect(process.properties.map((p: any) => p.id), 'Property_1 is taken').toEqual(['Property_1', 'Property_2', 'Property_3']);

  retype('Property_2', 'string');
  retype('Property_3', 'string');
  expect(typeOf('Property_2').id, 'a new structure gets an item definition').toBe('ItemDefinition_string');
  expect(typeOf('Property_3'), 'the same structure shares it').toBe(typeOf('Property_2'));
  retype('Property_1', 'pandas.Series');
  expect(typeOf('Property_1'), 'a structure the file declares keeps its item definition').toBe(series);
  retype('Property_2', 'dict[str, int]');
  expect(typeOf('Property_2').id, 'a type is free text; its id keeps the NCName characters').toBe('ItemDefinition_dict_str__int_');
  retype('Property_3', '');
  expect(typeOf('Property_3'), 'untyped').toBeUndefined();

  // The type field suggests the built-in types, then the file's own, each once.
  const options = itemTypeOptions(process);
  expect(options.slice(-2)).toEqual(['dict[str, int]', 'pandas.Series']);
  expect(options.filter((type) => type === 'string')).toHaveLength(1);
});

test('a step may bind what its scopes declare, outward, an inner name hiding an outer one, and nothing a sibling declares', () => {
  const m = freshModdle();
  const property = (id: string, name: string) => m.create('bpmn:Property', { id, name });
  const step = m.create('bpmn:Task', { id: 'Step' });
  const loop = m.create('bpmn:SubProcess', { id: 'Loop', properties: [property('Loop_n', 'n')], flowElements: [step] });
  const prepare = m.create('bpmn:SubProcess', { id: 'Prepare', properties: [property('Prepare_features', 'features')] });
  const study = m.create('bpmn:Process', {
    id: 'Study', properties: [property('Study_n', 'n'), property('Study_arm', 'arm')], flowElements: [loop, prepare],
  });
  step.$parent = loop;
  loop.$parent = study;
  prepare.$parent = study;

  expect(getPropertiesInScope(step).map((p) => `${p.name} from ${p.ownerId}`)).toEqual(['n from Loop', 'arm from Study']);
});

test.describe('property names', () => {
  test('a rename to a `_`-prefixed name is refused; the previous name stays', () => {
    const m = freshModdle();
    const property = m.create('bpmn:Property', { id: 'P1', name: 'count' });
    const process = m.create('bpmn:Process', { id: 'S', properties: [property] });
    property.$parent = process;
    const element = { id: 'S', businessObject: process };
    const modeler = editorOver(m, process);

    runUpdateStateProperties(modeler, { type: 'UpdateStateProperties', element, action: 'rename', propertyId: 'P1', name: '_prov' });
    expect(property.name).toBe('count');

    runUpdateStateProperties(modeler, { type: 'UpdateStateProperties', element, action: 'rename', propertyId: 'P1', name: 'total' });
    expect(property.name).toBe('total');
  });

  test('a new property takes an id no other scope holds', () => {
    // Two `Property_1` in one file: the YAML keys elements by id, so saving, or an undo, kept only one of them.
    const m = freshModdle();
    const battery = m.create('bpmn:SubProcess', { id: 'Battery' });
    const counted = m.create('bpmn:Property', { id: 'Property_1', name: 'count' });
    const process = m.create('bpmn:Process', { id: 'S', properties: [counted], flowElements: [battery] });
    battery.$parent = process;
    counted.$parent = process;
    const modeler = editorOver(m, process);

    runUpdateStateProperties(modeler, { type: 'UpdateStateProperties', element: { id: 'Battery', businessObject: battery }, action: 'add' });
    expect(battery.properties.map((p: any) => p.id)).toEqual(['Property_2']);
  });
});
