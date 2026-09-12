import { expect, test } from '@playwright/test';

import { fromLinkml, parseLinkml } from '@core/notation/linkml';

/** Each LinkML key the reader maps, on one small pair of schemas; `skills/SCHEMAS.md` documents the same table. */

const CORE = parseLinkml(`
id: http://example.test/core
name: core
title: Core
rank: 1
annotations: { icon: iconify ph--flask, core: true }
subsets:
  Data: { rank: 40 }
  Execution: { rank: 50, annotations: { synthetic: true } }
types:
  Markdown: { typeof: string, annotations: { editor: markdown } }
enums:
  Format:
    permissible_values:
      csv: { title: CSV, annotations: { icon: iconify ph--table } }
      tsv: {}
classes:
  Table:
    implements: [bpmn:DataObjectReference]
    annotations: { roles: { value: [signal] } }
    attributes:
      name: {}
      rows: { range: integer, ifabsent: int(3), rank: 1, in_subset: [Data] }
      format: { range: Format, ifabsent: string(csv) }
      tags: { multivalued: true }
      notes: { range: Markdown, annotations: { element: true } }
      shown: { annotations: { condition: { value: { format: $set } } } }
  Flow:
    mixin: true
    implements: [bpmn:SequenceFlow, bpmn:Activity]
    attributes:
      conditionExpression:
        slot_uri: bpmn:conditionExpression
        implements: [bpmn:Expression]
        annotations: { redefines: bpmn:SequenceFlow#conditionExpression }
  Holder:
    attributes:
      value: { annotations: { body: true, element: true } }
`);

const SKILL = parseLinkml(`
id: http://example.test/skill
name: skill
classes:
  Recording:
    is_a: Table
    attributes:
      live: { range: boolean, ifabsent: 'true' }
enums:
  MoreFormats:
    apply_to: [Format]
    permissible_values:
      parquet: { title: Parquet }
`);

const [core, skill] = fromLinkml([CORE, SKILL]);
const type = (name: string) => [...core.types, ...skill.types].find((entry) => entry.name === name)!;
const property = (typeName: string, name: string) => type(typeName).properties!.find((entry) => entry.name === name)!;

test('the schema header maps to the package, and the subsets to inspector tabs', () => {
  expect(core).toMatchObject({ prefix: 'core', name: 'Core', uri: 'http://example.test/core', order: 1, icon: 'iconify ph--flask', core: true });
  expect(core.categories).toEqual([
    { name: 'Data', order: 40, description: undefined, synthetic: false },
    { name: 'Execution', order: 50, description: undefined, synthetic: true },
  ]);
  expect(skill.name).toBe('skill');
});

test('implements names the BPMN element, as a wrapper or, on a mixin, as a trait', () => {
  expect(type('Table')).toMatchObject({ superClass: ['bpmn:DataObjectReference'], isAbstract: false, meta: { roles: ['signal'] } });
  expect(type('Flow')).toMatchObject({ extends: ['bpmn:SequenceFlow', 'bpmn:Activity'], isAbstract: true });
  expect(type('Flow').superClass).toBeUndefined();
  expect(type('Holder').superClass).toEqual(['Element']);
  expect(type('Markdown')).toMatchObject({ superClass: ['String'], meta: { editor: 'markdown' } });
});

test('a name another schema declares is qualified with its prefix; the file\'s own stays bare', () => {
  expect(type('Recording').superClass).toEqual(['core:Table']);
  expect(property('Table', 'format').type).toBe('Format');
  expect(skill.enumerations).toEqual([{ extends: 'core:Format', description: undefined, literalValues: [
    { name: 'Parquet', value: 'parquet', description: undefined, icon: undefined },
  ] }]);
});

test('attributes: range, default, list, tab, and whether it is an XML attribute', () => {
  expect(property('Table', 'name')).toMatchObject({ type: 'String', isAttr: true, isMany: false });
  expect(property('Table', 'rows')).toMatchObject({ type: 'Integer', default: 3, meta: { order: 1, categories: ['Data'] } });
  expect(property('Table', 'format').default).toBe('csv');
  expect(property('Recording', 'live').default).toBe(true);
  expect(property('Table', 'tags')).toMatchObject({ isMany: true, isAttr: false });
  expect(property('Table', 'notes')).toMatchObject({ type: 'Markdown', isAttr: false });
  expect(property('Table', 'notes').meta).toBeUndefined();
  expect(property('Table', 'shown').meta).toEqual({ condition: { format: '$set' } });
  expect(property('Holder', 'value')).toMatchObject({ isBody: true, isAttr: false });
});

test('a slot implementing a BPMN expression keeps its BPMN name and is written with its xsi:type', () => {
  expect(property('Flow', 'bpmn:conditionExpression')).toMatchObject({
    type: 'bpmn:Expression',
    isAttr: false,
    redefines: 'bpmn:SequenceFlow#conditionExpression',
    xml: { serialize: 'xsi:type' },
    meta: { expression: true },
  });
});

test('permissible values become literals: the title is the name, the key the value', () => {
  expect(core.enumerations[0]).toEqual({ name: 'Format', description: undefined, literalValues: [
    { name: 'CSV', value: 'csv', description: undefined, icon: 'iconify ph--table' },
    { name: 'tsv', value: 'tsv', description: undefined, icon: undefined },
  ] });
});
