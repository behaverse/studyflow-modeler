import { expect, test } from '@playwright/test';
import { buildCatalog } from '@behaverse/studyflow-core/notation';
import type { SchemaModel } from '@behaverse/studyflow-core/notation/schemaFile';

/** The compiler's author-typo diagnostics: a broken schema must fail in words at load time. */

function schema(partial: Partial<SchemaModel>): SchemaModel {
  return {
    name: 'Test',
    prefix: 'test',
    uri: 'http://example.org/test',
    types: [],
    enumerations: [],
    ...partial,
  } as SchemaModel;
}

test('a typo in meta.bpmnType warns and drops the attach point instead of crashing later', () => {
  const catalog = buildCatalog([schema({
    types: [{ name: 'Thing', superClass: ['Element'], meta: { bpmnType: 'bpmn:Taskk' } } as any],
  })]);
  expect(catalog.diagnostics.join('\n')).toContain("unknown BPMN type 'bpmn:Taskk'");
  expect(catalog.getType('test:Thing')?.bpmnType).toBeNull();
});

test('duplicate schema prefixes: first wins, loudly', () => {
  const catalog = buildCatalog([
    schema({ name: 'First' }),
    schema({ name: 'Second' }),
  ]);
  expect(catalog.diagnostics.join('\n')).toContain('duplicate schema prefix');
  expect(catalog.schemas).toHaveLength(1);
  expect(catalog.schemas[0].name).toBe('First');
});

test('an enum-typed default outside the literals is a diagnostic', () => {
  const catalog = buildCatalog([schema({
    enumerations: [{ name: 'ModeEnum', literalValues: [{ name: 'A', value: 'a' }] } as any],
    types: [{
      name: 'Thing',
      superClass: ['Element'],
      properties: [{ name: 'mode', isAttr: true, type: 'ModeEnum', default: 'zzz' }],
    } as any],
  })]);
  expect(catalog.diagnostics.join('\n')).toContain("default 'zzz' is not a literal of");
});

test('an unknown meta.editor name is a diagnostic listing the known ones', () => {
  const catalog = buildCatalog([schema({
    types: [{
      name: 'Thing',
      superClass: ['Element'],
      properties: [{ name: 'body', isAttr: true, type: 'String', meta: { editor: 'yamll' } }],
    } as any],
  })]);
  expect(catalog.diagnostics.join('\n')).toContain("unknown editor 'yamll'");
});

test('an unqualified ref matching several schemas warns and resolves deterministically', () => {
  const catalog = buildCatalog([
    schema({ prefix: 'aaa', types: [{ name: 'Shared', superClass: ['Element'] } as any] }),
    schema({
      prefix: 'bbb',
      types: [
        { name: 'Shared', superClass: ['Element'] } as any,
        { name: 'User', superClass: ['Element'], properties: [{ name: 'ref', isAttr: true, type: 'Shared' }] } as any,
      ],
    }),
  ]);
  // The owner's own schema wins (bbb:Shared); ambiguity arises only for a prefix that declares no match itself.
  const catalog2 = buildCatalog([
    schema({ prefix: 'aaa', types: [{ name: 'Shared', superClass: ['Element'] } as any] }),
    schema({ prefix: 'bbb', types: [{ name: 'Shared', superClass: ['Element'] } as any] }),
    schema({
      prefix: 'ccc',
      types: [{ name: 'Mixin', extends: ['Shared'] } as any],
    }),
  ]);
  expect(catalog2.diagnostics.join('\n')).toContain('unqualified ref matches 2 schemas');
  expect(catalog.diagnostics.join('\n')).not.toContain('unqualified ref');
});
