import { expect, test } from '@playwright/test';

import { collectChecklistGroups } from '@modeler/checklist/groups';
import { loadYaml } from '../packages/canvas/tests/canvasHarness';

/** A sub-process whose name cites the last run's state (docs/reference.qmd, "Placeholders"), carrying a checklist. */
const YAML = `id: Defs_Checklist
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_Checklist:
  type: Process
  extensionElements:
    - type: studyflow:Study
  flowElements:
    Battery:
      type: SubProcess
      name: Battery (n={reached})
      checklist: |-
        - [x] consent
        - [ ] debrief
      bounds: 100 100 200 160
`;

const REACHED = `state:
  _meta:
    reached:
      Battery: 3
`;

test("a checklist group heading shows the last run's state where its name cites it, and 0 where no run reached it", () => {
  for (const [yaml, expected] of [[YAML + REACHED, 'Battery (n=3)'], [YAML, 'Battery (n=0)']] as const) {
    const { canvas, definitions } = loadYaml(yaml);
    const groups = collectChecklistGroups({ canvas, getDefinitions: () => definitions } as any);
    expect(groups.map((g) => g.label), expected).toEqual([expected]);
    // The model keeps the placeholder; only the view resolves it.
    expect(canvas.all().find((el) => el.id === 'Battery')!.businessObject.name).toContain('{reached}');
  }
});
