import { expect, test } from '@playwright/test';

import { buildCatalog } from '@core/notation';
import { fromModdleYaml, type SchemaModel } from '@core/notation/moddlePackage';

/** The compiler's diagnostics for an author's mistakes: a broken schema fails in words at load time. */

/** A schema of prefix `lab`, the rest of its file given. */
const lab = (rest: string, name = 'Lab') => fromModdleYaml(`name: ${name}\nprefix: lab\nuri: http://example.test/lab\n${rest}`);

test('each authoring mistake gets a diagnostic that names it', () => {
  // A diagnostic names the type or property at fault and the offending value; its prose is the compiler's.
  const CASES: Array<[string, SchemaModel[], RegExp]> = [
    ['a typo in the BPMN attach point', [lab('types: [{ name: Thing, superClass: [bpmn:Taskk] }]')], /lab:Thing.*bpmn:Taskk/],
    ['a superClass no schema declares', [lab('types: [{ name: Thing, superClass: [NoSuchType] }]')], /lab:Thing.*NoSuchType/],
    ['two schemas with one prefix', [lab('', 'First'), lab('', 'Second')], /duplicate.*Second.*First/],
    ['an enum default outside its values', [lab(`
enumerations: [{ name: Mode, literalValues: [{ name: A, value: a }] }]
types: [{ name: Thing, properties: [{ name: mode, isAttr: true, type: Mode, default: zzz }] }]`)],
      /Thing\.mode.*zzz.*lab:Mode/],
    ['a meta.editor naming no editor', [lab('types: [{ name: Thing, properties: [{ name: body, isAttr: true, type: String, meta: { editor: yamll } }] }]')],
      /Thing\.body.*editor.*yamll/],
  ];
  for (const [mistake, schemas, diagnostic] of CASES) {
    expect(buildCatalog(schemas).diagnostics.join('\n'), mistake).toMatch(diagnostic);
  }
  // A file that is no package is refused before it compiles; the loader lists it among SCHEMA_LOAD_FAILURES.
  expect(() => fromModdleYaml('name: Lab\nuri: http://example.test/lab'), 'a file without a prefix').toThrow(/prefix/);
});
