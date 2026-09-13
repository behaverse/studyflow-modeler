
import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { BPMN_ANCESTORS, isBpmnSubtypeOf } from '@core/notation';
import { loadSchemaModels, schemaPackages } from './schemas';

/** Cross-validates the compiled TypeCatalog against bpmn-moddle. */


const moddle = new BpmnModdle(schemaPackages(loadSchemaModels())) as any;

test.describe('catalog: static BPMN ancestor table', () => {
  test('every listed ancestor is real according to bpmn-moddle', () => {
    for (const [type, ancestors] of Object.entries(BPMN_ANCESTORS)) {
      const descriptor = moddle.getType(type)?.$descriptor;
      expect(descriptor, `${type} exists in bpmn-moddle`).toBeTruthy();
      const allTypes = new Set((descriptor.allTypes ?? []).map((t: any) => t.name));
      for (const ancestor of ancestors) {
        expect(allTypes.has(ancestor), `${type} -> ${ancestor}`).toBe(true);
      }
    }
  });

  test('category-relevant subtype checks agree with bpmn-moddle', () => {
    const relevant = [
      'bpmn:Event', 'bpmn:Gateway', 'bpmn:SubProcess', 'bpmn:Participant', 'bpmn:Group',
      'bpmn:Activity', 'bpmn:DataObjectReference', 'bpmn:DataStoreReference',
      'bpmn:ItemAwareElement', 'bpmn:BaseElement',
    ];
    for (const type of Object.keys(BPMN_ANCESTORS)) {
      const allTypes = new Set(
        (moddle.getType(type)?.$descriptor?.allTypes ?? []).map((t: any) => t.name),
      );
      for (const ancestor of relevant) {
        expect(
          isBpmnSubtypeOf(type, ancestor),
          `${type} subtype-of ${ancestor}`,
        ).toBe(allTypes.has(ancestor));
      }
    }
  });
});
