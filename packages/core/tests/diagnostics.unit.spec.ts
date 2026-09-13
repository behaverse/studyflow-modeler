import { expect, test } from '@playwright/test';

import { buildCatalog } from '@core/notation';
import { fromLinkml, parseLinkml, type LinkmlSchema } from '@core/notation/linkml';

/** The compiler's diagnostics for an author's mistakes: a broken schema fails in words at load time. */

/** A schema named `lab`, the rest of its file given. */
const lab = (rest: string) => parseLinkml(`id: http://example.test/lab\nname: lab\n${rest}`);

test('each authoring mistake gets a diagnostic that names it', () => {
  const CASES: Array<[string, LinkmlSchema[], string]> = [
    ['a typo in the BPMN attach point', [lab('classes: { Thing: { implements: [bpmn:Taskk] } }')],
      "[lab:Thing] implements names unknown BPMN type 'bpmn:Taskk'; the type will not be creatable"],
    ['an is_a no schema declares', [lab('classes: { Thing: { is_a: NoSuchType } }')],
      "[lab:Thing] unresolved is_a ref 'NoSuchType'"],
    ['two schemas with one name', [lab('title: First'), lab('title: Second')],
      "duplicate schema prefix: 'Second' ignored (already provided by 'First')"],
    ['an enum default outside its values', [lab(`
enums: { Mode: { permissible_values: { a: {} } } }
classes: { Thing: { attributes: { mode: { range: Mode, ifabsent: string(zzz) } } } }`)],
      "[lab Thing.mode] default 'zzz' is not a literal of lab:Mode"],
    ['an editor annotation naming no editor', [lab('classes: { Thing: { attributes: { body: { annotations: { editor: yamll } } } } }')],
      "[lab Thing.body] names unknown editor 'yamll'"],
  ];
  for (const [mistake, schemas, diagnostic] of CASES) {
    expect(buildCatalog(fromLinkml(schemas)).diagnostics.join('\n'), mistake).toContain(diagnostic);
  }
});
