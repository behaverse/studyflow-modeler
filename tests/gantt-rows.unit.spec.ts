import { expect, test } from '@playwright/test';

import { collectGanttRows } from '@modeler/gantt/rows';
import { loadYaml } from '../packages/canvas/tests/canvasHarness';

/** A timed step whose name cites the last run's state (docs/reference.qmd, "Placeholders"). */
const STATE_YAML = `id: Defs_Gantt
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_Gantt:
  type: Process
  extensionElements:
    - type: studyflow:Study
  flowElements:
    Screening:
      type: Task
      name: Screening (n={reached})
      onset: T0
      duration: 1 week
      bounds: 100 100 100 80
state:
  _meta:
    reached:
      Screening: 96
`;

test('a Gantt row shows the last run\'s state where its name cites it; the model keeps the placeholder', () => {
  const { canvas, definitions } = loadYaml(STATE_YAML);
  const rows = collectGanttRows({ canvas, getDefinitions: () => definitions } as any);
  expect(rows.map((row) => row.label)).toEqual(['Screening (n=96)']);
  expect(canvas.all().find((el) => el.id === 'Screening')!.businessObject.name).toBe('Screening (n={reached})');
});
