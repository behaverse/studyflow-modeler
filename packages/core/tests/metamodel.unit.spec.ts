import { expect, test } from '@playwright/test';

import { Metamodel, type PackageDef } from '@core/model/metamodel';
import { freshModdle } from '@tests/schemas';

/** The metamodel reads the package definitions moddle reads, and gives every type what moddle gives it. */

const FLAGS = ['isMany', 'isReference', 'isAttr', 'isBody', 'isId', 'isVirtual', 'default', 'inherited'] as const;

test('every type of every package holds the properties moddle gives it, in its order, with its flags', () => {
  const moddle = freshModdle();
  const metamodel = new Metamodel(structuredClone(moddle.getPackages()) as PackageDef[]);
  // A trait, a type that extends others, is no type an element is: it only adds properties to those it extends.
  const names = metamodel.types().filter((type) => type.extends.length === 0).map((type) => type.name);
  expect(names.length).toBeGreaterThan(150);
  for (const name of names) {
    const ours = metamodel.descriptor(name);
    const theirs = moddle.registry.getEffectiveDescriptor(name);
    const shape = (properties: any[]) => properties.map((p) => [p.name, p.ns.name, p.type, ...FLAGS.map((flag) => p[flag])]);
    expect(shape(ours.properties), name).toEqual(shape(theirs.properties));
    expect(Object.keys(ours.allTypesByName), name).toEqual(Object.keys(theirs.allTypesByName));
    expect(Object.keys(ours.propertiesByName).sort(), name).toEqual(Object.keys(theirs.propertiesByName).sort());
    expect([ours.bodyProperty?.name, ours.idProperty?.name], name).toEqual([theirs.bodyProperty?.name, theirs.idProperty?.name]);
  }
  expect(metamodel.isA('bpmn:UserTask', 'bpmn:Activity')).toBe(true);
  expect(metamodel.isA('bpmn:Task', 'bpmn:Event')).toBe(false);
  expect(metamodel.isA('bpmn:Task', 'studyflow:Checklist')).toBe(true);
});
