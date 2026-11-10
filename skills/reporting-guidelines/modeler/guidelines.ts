/**
 * The guidelines this skill knows, in the order the modeler lists them. Adding one is a module beside these that
 * exports a `Guideline` (`guideline.ts`), and its line here; SKILL.md, "Adding a guideline", says the rest.
 */
import type { Guideline } from '@skills/reporting-guidelines/modeler/guideline';
import { consort } from '@skills/reporting-guidelines/modeler/consort';
import { spirit } from '@skills/reporting-guidelines/modeler/spirit';

export const GUIDELINES: Guideline[] = [consort, spirit];
