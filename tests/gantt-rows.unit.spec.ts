import { expect, test } from '@playwright/test';

import { axisTicks, collectGanttRows, dependencyPath, tickLabel } from '@modeler/gantt/rows';
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

/** A sub-process stating no timing, holding two timed tasks; a timed task outside it. */
const GROUP_YAML = `id: Defs_GanttGroup
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_Group:
  type: Process
  extensionElements:
    - type: studyflow:Study
  flowElements:
    Setup:
      type: Task
      name: Setup
      onset: T0
      duration: 1 d
      progress: done
      bounds: 100 100 100 80
    WP:
      type: SubProcess
      name: WP
      bounds: 250 50 400 200
      stroke: "#728cb9"
      flowElements:
        A:
          type: Task
          name: A
          onset: T0+1 d
          duration: 2 d
          progress: "50"
          bounds: 270 100 100 80
        B:
          type: Task
          name: B
          onset: T0+2 d
          duration: 3 d
          bounds: 400 100 100 80
`;

test('a sub-process holding scheduled elements is a group row ahead of them, with their span and mean progress when it states none', () => {
  const { canvas, definitions } = loadYaml(GROUP_YAML);
  const rows = collectGanttRows({ canvas, getDefinitions: () => definitions } as any);
  expect(rows.map((row) => [row.id, row.parent, row.group])).toEqual([['Setup', undefined, undefined], ['WP', undefined, true], ['A', 'WP', undefined], ['B', 'WP', undefined]]);
  expect(rows[1]).toMatchObject({ onsetMin: 1440, durationMin: 4 * 1440, progressPct: 50, progressText: '50%', stroke: '#728cb9' });
});

test('an arrow drops straight when the waiting bar starts at or after the end it leaves, and steps out, turns back in the gap just before the waiting row, and turns in when it starts before', () => {
  const from = { x: 0, y: 0, w: 100, stroke: '' };
  expect(dependencyPath(from, { x: 120, y: 32, w: 50, stroke: '' })).toBe('M 100 12 L 118 12 Q 126 12 126 20 L 126 32');
  // Two rows down: the turn is at y=60, the gap above the waiting row, not at y=28 beside the leaving one.
  expect(dependencyPath(from, { x: 60, y: 64, w: 50, stroke: '' }))
    .toBe('M 100 12 L 104 12 Q 108 12 108 16 L 108 52 Q 108 60 100 60 L 68 60 Q 66 60 66 62 L 66 64');
  // Upwards: into the bottom of the bar above, through the gap below it.
  expect(dependencyPath({ ...from, y: 64 }, { x: 60, y: 0, w: 50, stroke: '' })).toContain('L 108 36 Q 108 28 100 28 L 68 28 Q 66 28 66 26 L 66 24');
});
