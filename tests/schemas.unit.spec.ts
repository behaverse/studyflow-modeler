import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { BPMN_ANCESTORS, buildCatalog } from '@core/notation';
import { MODDLE_BUILTIN_TYPES, type SchemaModel } from '@core/notation/moddlePackage';
import { SCHEMAS, freshModdle, loadSchemaModels } from './schemas';

/** The shipped schemas, each rule checked across all of them, as the app loads them. */

const models = loadSchemaModels();
const catalog = buildCatalog(models);

/** What the schema declares by name: its types and enums (an `extends` entry adds to another's). */
function namesOf(model: SchemaModel): string[] {
  return [...model.types.map((type) => type.name), ...model.enumerations.flatMap((entry) => entry.name ?? [])];
}

/** The JavaScript type a default of a moddle built-in holds; anything else holds a string. */
const JS_TYPE: Record<string, string> = { Boolean: 'boolean', Integer: 'number', Real: 'number' };

test('the shipped schemas compile with no diagnostics', () => {
  expect(catalog.diagnostics).toEqual([]);
});

// Two schemas with one prefix are a compile diagnostic; a shared URI or name is not.
test('no two schemas share a URI or declare the same name, and the required ones are studyflow, prov, cognitive, local', () => {
  const uris = models.map((model) => model.uri);
  expect(new Set(uris).size, 'one URI per schema').toBe(uris.length);

  // The catalog looks a bare name up in every schema and takes the first it finds (`getType('Agent')`), so each name is one schema's.
  const owners = new Map<string, string>();
  for (const model of models) {
    for (const name of namesOf(model)) {
      expect(owners.get(name), `${model.prefix}:${name} is also ${owners.get(name)}:${name}`).toBeUndefined();
      owners.set(name, model.prefix);
    }
  }

  expect(SCHEMAS.filter((schema) => schema.required).map((schema) => schema.prefix).sort())
    .toEqual(['cognitive', 'local', 'prov', 'studyflow']);
});

test('each schema has a quoted YY.M.N version, an http(s) uri, a lowercase prefix, a lowerCase tagAlias, a one-row blurb and PascalCase names', () => {
  for (const model of models) {
    // YY.M.N, as the app's own version; quoted, or YAML reads a two-part version as a float.
    expect(model.version, `${model.prefix} version`).toMatch(/^\d{2}\.(?:[1-9]|1[0-2])\.\d+$/);
    expect(model.uri, `${model.prefix} uri`).toMatch(/^https?:\/\//);
    expect(model.prefix, `${model.prefix} is lowercase`).toBe(model.prefix.toLowerCase());
    expect(model.xml?.tagAlias, `${model.prefix} tagAlias`).toBe('lowerCase');
    for (const name of namesOf(model)) expect(name, `${model.prefix}:${name}`).toMatch(/^[A-Z][A-Za-z0-9]*$/);
  }
  for (const schema of SCHEMAS) {
    expect(schema.description, `${schema.prefix} blurb`).not.toBe('');
    expect(schema.description.length, `${schema.prefix} blurb fits a Settings row`).toBeLessThan(320);
  }
});

test('every attribute files under a declared tab, names a type that resolves, and defaults to a value of that type', () => {
  const tabs = catalog.categories().map((category) => category.name);
  const resolves = (type: string) => MODDLE_BUILTIN_TYPES.has(type) || type in BPMN_ANCESTORS
    || catalog.getType(type) !== undefined || catalog.enumOf(type) !== undefined;

  for (const type of catalog.allTypes()) {
    for (const spec of type.attributes) {
      const where = `${type.name} ${spec.ns.name}`;
      for (const tab of spec.meta?.categories ?? []) expect(tabs, `${where} files under "${tab}"`).toContain(tab);
      expect(resolves(spec.type), `${where} is a ${spec.type}`).toBe(true);
      if (spec.default === undefined) continue;
      expect(typeof spec.default, `${where} default`).toBe(JS_TYPE[spec.type] ?? 'string');
      if (spec.type === 'Integer') expect(Number.isInteger(spec.default), `${where} default`).toBe(true);
    }
  }
});

test('every concrete type and every trait target instantiates in moddle as its BPMN type, holding each attribute with the catalog\'s default', () => {
  const traits = catalog.allTypes().filter((type) => type.style === 'trait');
  // The catalog lends a trait's attributes to the subtypes BPMN_ANCESTORS lists, where moddle lends them to every subtype.
  for (const trait of traits) {
    for (const target of trait.extends) expect(target in BPMN_ANCESTORS, `${trait.name} extends ${target}`).toBe(true);
  }

  const moddle = freshModdle();
  const concrete = catalog.allTypes().filter((type) => type.style === 'wrapper' && !type.isAbstract).map((type) => type.name);
  for (const name of [...concrete, ...new Set(traits.flatMap((trait) => trait.extends))]) {
    const element = moddle.create(name);
    const bpmnType = catalog.bpmnTypeOf(name);
    if (bpmnType) expect(element.$instanceOf(bpmnType), `${name} is a ${bpmnType}`).toBe(true);
    const { propertiesByName } = moddle.getElementDescriptor(element);
    for (const spec of catalog.instanceAttributesOf(name)) {
      expect(propertiesByName[spec.ns.name], `${name} holds ${spec.ns.name}`).toBeDefined();
      expect(propertiesByName[spec.ns.name].default, `${name} ${spec.ns.name} default`).toEqual(spec.default);
    }
  }
});

test('every template reads as studyflow with no warnings, is rooted on a BPMN element, and has a palette icon', () => {
  const moddle = freshModdle();
  for (const model of models) {
    for (const template of model.templates ?? []) {
      const label = `${model.prefix}: ${template.description}`;
      expect(typeof template.description, `${model.prefix} template description`).toBe('string');
      const warnings: string[] = [];
      const definitions = studyflowToDefinitions({ definitions: {}, elements: template.elements }, moddle, (message) => warnings.push(message));
      expect(definitions.rootElements.length, label).toBeGreaterThan(0);
      expect(warnings, label).toEqual([]);
    }
  }
  for (const template of catalog.allTemplates()) {
    expect(template.bpmnType, template.id).toMatch(/^bpmn:/);
    expect(template.iconClass, template.id).toBeTruthy();
  }
  // The palette entry is read off the first element: the pool, not the process holding its flow.
  expect(catalog.allTemplates().find((template) => template.name === 'EEG session'))
    .toMatchObject({ bpmnType: 'bpmn:Participant', extensionType: 'eeg:Session', iconClass: expect.stringMatching(/^iconify \S+--/) });
});

// A cognitive task is a choreography task, not a bpmn:Activity, and a battery still puts each on the Gantt.
test('a cognitive task takes an onset and a duration like any activity', () => {
  const warnings: string[] = [];
  const elements = {
    Task: { type: 'ChoreographyTask', extensionElements: [{ type: 'cognitive:CognitiveTask' }], onset: 'T0+6min', duration: '5min' },
  };
  studyflowToDefinitions({ definitions: {}, elements }, freshModdle(), (message) => warnings.push(message));
  expect(warnings).toEqual([]);
});

test('the inspector tabs are General, one per other schema, Documentation, Gantt, Data and Execution', () => {
  const others = catalog.schemas.filter((schema) => schema.prefix !== 'studyflow').map((schema) => schema.name);
  const categories = catalog.categories();
  expect(categories.map((category) => category.name)).toEqual(['General', ...others, 'Documentation', 'Gantt', 'Data', 'Execution']);
  expect(categories.filter((category) => category.synthetic).map((category) => category.name), 'drawn by a section of its own')
    .toEqual(['Execution']);
  // An attribute that names no tab files under its schema's own; studyflow's and BPMN's under General.
  expect(['studyflow', 'cognitive', 'bpmn'].map((prefix) => catalog.defaultCategoryOf(prefix))).toEqual(['General', 'Cognitive', 'General']);
});

// A mode the runners lack silently takes the default branch, so the declared set is pinned to the arms they have.
test('gateways declare only branching modes the runners implement', () => {
  for (const type of catalog.allTypes()) {
    if (type.meta.branching !== undefined) expect(['random', 'condition', 'model'], type.name).toContain(type.meta.branching);
  }
  expect(catalog.getType('cognitive:RandomGateway')?.meta.branching, 'an allocation gateway draws its branch').toBe('random');
});
