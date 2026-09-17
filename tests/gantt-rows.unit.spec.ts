import { expect, test } from '@playwright/test';

import { axisTicks, collectGanttRows, tickLabel } from '@modeler/gantt/rows';
import { loadYaml } from '../packages/canvas/tests/canvasHarness';

/** A timed step whose name cites the last run's state (docs/reference.qmd, "Placeholders"), then a gateway, then a timed step with a checklist. */
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
      fill: "#d9e7d6"
      stroke: "#8cb26e"
    Eligible:
      type: ExclusiveGateway
      bounds: 250 120 40 40
    Baseline:
      type: Task
      name: Baseline
      onset: T0+1 week
      checklist: |-
        - [x] consent
        - [ ] MRI
        - [x] survey
        - [ ] bloods
        - [ ] tasks
      bounds: 350 100 100 80
    Flow_1:
      sourceRef: Screening
      targetRef: Eligible
      waypoint: 200,140 250,140
    Flow_2:
      sourceRef: Eligible
      targetRef: Baseline
      waypoint: 290,140 350,140
state:
  _meta:
    reached:
      Screening: 96
`;

test('a Gantt row wears its element\'s colours, waits on the scheduled steps upstream through a gateway, takes its progress from its checklist when it states none, and shows the last run\'s state where its name cites it; the model keeps the placeholder', () => {
  const { canvas, definitions } = loadYaml(STATE_YAML);
  const rows = collectGanttRows({ canvas, getDefinitions: () => definitions } as any);
  expect(rows.map((row) => row.label)).toEqual(['Screening (n=96)', 'Baseline']);
  expect(rows[0]).toMatchObject({ fill: '#d9e7d6', stroke: '#8cb26e' });
  expect(rows.map((row) => row.after)).toEqual([[], ['Screening']]);
  expect(rows[1]).toMatchObject({ progress: '2 of 5 items', progressPct: 40, progressText: '2/5' });
  expect(canvas.all().find((el) => el.id === 'Screening')!.businessObject.name).toBe('Screening (n={reached})');
});

test('the time axis picks the smallest step that gives at most the ticks its width holds, labelled from T0', () => {
  expect(axisTicks(0, 51)).toEqual([0, 10, 20, 30, 40, 50]);
  expect(axisTicks(0, 51, 3)).toEqual([0, 30]);
  expect(axisTicks(0, 26 * 7 * 24 * 60).length).toBeLessThanOrEqual(8);
  expect(axisTicks(0, 7)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(axisTicks(0, 7 * 24 * 60).length).toBeLessThanOrEqual(8);
  expect([0, 10, 90, 1440, 20160, -5].map(tickLabel)).toEqual(['T0', '+10 min', '+90 min', '+1 d', '+2 w', '-5 min']);
});
