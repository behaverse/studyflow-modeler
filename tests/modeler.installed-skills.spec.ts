import { expect, test } from './e2e';

import { addSchemaPaletteElement, gotoModeler, runPaletteCommand } from './utils';

/** A skill installed beside the CLI (`studyflow skill add`): `studyflow edit` serves its schema as
 * `installed-skills.json`, and the modeler loads it with its own, locked on in Settings, its elements in the palette. */

const SCHEMA = `name: Lab rig
prefix: lab
uri: http://example.org/lab
description: A rig the lab drives.
types:
  - name: Rig
    description: A step the lab's rig runs.
    superClass:
      - bpmn:Task
    meta:
      icon: iconify ph--robot
    properties:
      - name: platform
        isAttr: true
        type: String
`;

test('the modeler loads the schema of a skill installed beside the CLI', async ({ page }) => {
  await page.route('**/installed-skills.json', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ skill: 'lab', description: 'The lab rig.', schema: 'lab/lab.moddle.yaml', source: SCHEMA }]),
  }));
  await gotoModeler(page);

  await addSchemaPaletteElement(page, 'Lab rig', 'Rig', { x: 400, y: 300 });
  // Dropped and selected, the new step is the installed schema's type.
  await expect(page.getByTestId('inspector-root')).toContainText('Rig');

  await runPaletteCommand(page, /^Settings/);
  await page.getByText(/^Extensions$/).first().click();
  const toggle = page.getByRole('switch', { name: 'Load the Lab rig elements' });
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeDisabled();
});
