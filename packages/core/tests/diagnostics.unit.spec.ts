import { expect, test } from '@playwright/test';

import { buildCatalog } from '@core/notation';
import { fromModdleYaml, type SchemaModel } from '@core/notation/moddlePackage';

/** The compiler's diagnostics for an author's mistakes: a broken schema fails in words at load time. */

/** A schema of prefix `lab`, the rest of its file given. */
const lab = (rest: string, name = 'Lab') => fromModdleYaml(`name: ${name}\nprefix: lab\nuri: http://example.test/lab\n${rest}`);

test('each authoring mistake gets a diagnostic that names it', () => {
  const CASES: Array<[string, SchemaModel[], string]> = [
    ['a typo in the BPMN attach point', [lab('types: [{ name: Thing, superClass: [bpmn:Taskk] }]')],
      "[lab:Thing] superClass names unknown BPMN type 'bpmn:Taskk'; the type will not be creatable"],
    ['a superClass no schema declares', [lab('types: [{ name: Thing, superClass: [NoSuchType] }]')],
      "[lab:Thing] unresolved superClass ref 'NoSuchType'"],
    ['two schemas with one prefix', [lab('', 'First'), lab('', 'Second')],
      "duplicate schema prefix: 'Second' ignored (already provided by 'First')"],
    ['an enum default outside its values', [lab(`
enumerations: [{ name: Mode, literalValues: [{ name: A, value: a }] }]
types: [{ name: Thing, properties: [{ name: mode, isAttr: true, type: Mode, default: zzz }] }]`)],
      "[lab Thing.mode] default 'zzz' is not a literal of lab:Mode"],
    ['a meta.editor naming no editor', [lab('types: [{ name: Thing, properties: [{ name: body, isAttr: true, type: String, meta: { editor: yamll } }] }]')],
      "[lab Thing.body] names unknown editor 'yamll'"],
  ];
  for (const [mistake, schemas, diagnostic] of CASES) {
    expect(buildCatalog(schemas).diagnostics.join('\n'), mistake).toContain(diagnostic);
  }
  // A file that is no package is refused before it compiles; the loader lists it among SCHEMA_LOAD_FAILURES.
  expect(() => fromModdleYaml('name: Lab\nuri: http://example.test/lab'), 'a file without a prefix').toThrow('must declare `name`, `prefix` and `uri`');
});
