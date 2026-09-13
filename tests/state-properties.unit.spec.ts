import { expect, test } from '@playwright/test';

import { IdGenerator } from '@canvas/index.ts';
import { runUpdateStateProperties } from '@modeler/inspector/commands';
import type { Editor } from '@modeler/editor/port';
import { freshModdle } from './schemas';

/** State as BPMN's own declared variables. */

test.describe('property names', () => {
  test('a rename to a `_`-prefixed name is refused; the previous name stays', () => {
    const m = freshModdle();
    const property = m.create('bpmn:Property', { id: 'P1', name: 'count' });
    const process = m.create('bpmn:Process', { id: 'S', properties: [property] });
    property.$parent = process;
    const element = { id: 'S', businessObject: process };
    const modeler = {
      canvas: {
        updateModdleProperties(_el: any, target: any, props: Record<string, any>) {
          for (const [k, v] of Object.entries(props)) target.set(k, v);
        },
      },
    } as unknown as Editor;

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
    const ids = IdGenerator.fromDefinitions(m.create('bpmn:Definitions', { rootElements: [process] }));
    const modeler = {
      model: {
        createBusinessObject: (type: string, properties: Record<string, any>) => m.create(type, properties),
        ids: { assigned: (id: string) => ids.assigned(id) },
      },
      canvas: {
        updateModdleProperties(_el: any, target: any, props: Record<string, any>) {
          for (const [k, v] of Object.entries(props)) target.set(k, v);
        },
      },
    } as unknown as Editor;

    runUpdateStateProperties(modeler, { type: 'UpdateStateProperties', element: { id: 'Battery', businessObject: battery }, action: 'add' });
    expect(battery.properties.map((p: any) => p.id)).toEqual(['Property_2']);
  });
});
