/** The reporting-guidelines skill's contribution to the modeler: each document of each guideline it knows, for the Reporting
 * Diagram view to draw. */
import type { ModelerModule } from '@modeler/skillModules';
import { GUIDELINES } from '@skills/reporting-guidelines/modeler/guidelines';

export default {
  documents: GUIDELINES.flatMap((guideline) => guideline.documents.map((document) => ({
    id: `${guideline.id}-${document.id}`,
    guideline: guideline.name,
    label: document.label,
    description: document.description,
    draw: document.draw,
  }))),
} satisfies ModelerModule;
