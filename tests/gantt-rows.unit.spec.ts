import { expect, test } from '@playwright/test';

import { axisTicks, collectGanttRows, dependencyPath, ROW_H, ROW_PAD, tickLabel } from '@modeler/gantt/rows';
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
  const [screening, baseline] = rows;
  expect(rows.map((row) => row.id)).toEqual(['Screening', 'Baseline']);
  expect(screening.label).toContain('96');
  expect(screening.label).not.toContain('{reached}');
  expect(screening).toMatchObject({ fill: '#d9e7d6', stroke: '#8cb26e', external: false });
  expect(rows.map((row) => row.after)).toEqual([[], ['Screening']]);
  expect(baseline.progressPct).toBe(40);
  expect(baseline.progressText).toBeTruthy();
  expect(canvas.all().find((el) => el.id === 'Screening')!.businessObject.name).toContain('{reached}');
});

test('the time axis picks the smallest step that gives at most the ticks its width holds, labelled from T0', () => {
  const evenlySpaced = (ticks: number[]) => new Set(ticks.slice(1).map((t, i) => t - ticks[i])).size === 1;
  for (const [max, maxTicks] of [[51, undefined], [51, 3], [7, undefined], [7 * 24 * 60, undefined], [26 * 7 * 24 * 60, undefined]] as const) {
    const ticks = axisTicks(0, max, maxTicks);
    expect(ticks[0]).toBe(0);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.length).toBeLessThanOrEqual(maxTicks ?? 8);
    expect(ticks.at(-1)!).toBeLessThanOrEqual(max);
    expect(evenlySpaced(ticks)).toBe(true);
  }
  expect(axisTicks(0, 51, 3).length).toBeLessThan(axisTicks(0, 51).length);
  expect(tickLabel(0)).toBe('T0');
  expect(tickLabel(10)).toMatch(/^\+10/);
  expect(tickLabel(-5)).toMatch(/^-5/);
  // Wider spans read in larger units, so the number stays small.
  expect(tickLabel(1440)).toMatch(/\b1\b/);
  expect(tickLabel(20160)).toMatch(/\b2\b/);
});

/** In one pool and lane: a sub-process stating no timing, holding two timed tasks, and a timed task outside it. */
const GROUP_YAML = `id: Defs_GanttGroup
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Collab_Group:
  type: Collaboration
  participants:
    Pool_Site:
      name: Site
      processRef: Process_Group
      bounds: 50 20 700 300
Process_Group:
  type: Process
  extensionElements:
    - type: studyflow:Study
  laneSets:
    LaneSet_Group:
      lanes:
        Lane_Ops:
          name: Ops
          flowNodeRef:
            - Setup
            - WP
          bounds: 80 20 670 300
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

test('a pool, lane or sub-process holding scheduled elements is a group row ahead of them, with their span and mean progress when it states none', () => {
  const { canvas, definitions } = loadYaml(GROUP_YAML);
  const rows = collectGanttRows({ canvas, getDefinitions: () => definitions } as any);
  expect(rows.map((row) => [row.id, row.parent, row.group])).toEqual([
    ['Pool_Site', undefined, true], ['Lane_Ops', 'Pool_Site', true],
    ['Setup', 'Lane_Ops', undefined], ['WP', 'Lane_Ops', true], ['A', 'WP', undefined], ['B', 'WP', undefined],
  ]);
  expect(rows[3]).toMatchObject({ onsetMin: 1440, durationMin: 4 * 1440, progressPct: 50, stroke: '#728cb9' });
  expect(rows[3].progressText).toBeTruthy();
  // The lane spans Setup and WP and averages them; the pool is the lane again.
  expect(rows[1]).toMatchObject({ label: 'Ops', onsetMin: 0, durationMin: 5 * 1440, progressPct: 75 });
  expect(rows[0]).toMatchObject({ label: 'Site', progressPct: 75 });
});

/** The x/y pairs a path visits, whatever commands join them. */
const points = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).reduce<[number, number][]>((acc, n, i, all) => (i % 2 ? acc : [...acc, [n, all[i + 1]]]), []);

test('an arrow leaves the end of its bar, lands on the waiting bar, and turns back only in the gap beside the waiting row', () => {
  const from = { x: 0, y: 0, w: 100, stroke: '' };
  const twoDown = from.y + 2 * (ROW_H + ROW_PAD);
  const cases: [typeof from, typeof from][] = [
    [from, { x: 120, y: twoDown, w: 50, stroke: '' }],
    [from, { x: 60, y: twoDown, w: 50, stroke: '' }],
    [{ ...from, y: twoDown }, { x: 60, y: 0, w: 50, stroke: '' }],
    // A sliver of a bar under the end: landed on its middle, not looped around.
    [from, { x: 98, y: twoDown, w: 4, stroke: '' }],
  ];
  for (const [a, b] of cases) {
    const pts = points(dependencyPath(a, b));
    const [x0, y0] = pts[0];
    const [x1, y1] = pts.at(-1)!;
    const down = b.y > a.y;
    expect(x0).toBe(a.x + a.w);
    expect(y0).toBeGreaterThan(a.y);
    expect(y0).toBeLessThan(a.y + ROW_H);
    expect(x1).toBeGreaterThanOrEqual(b.x);
    expect(x1).toBeLessThan(b.x + b.w);
    expect(y1).toBe(down ? b.y : b.y + ROW_H);
    for (const [x, y] of pts) {
      expect(y).toBeGreaterThanOrEqual(Math.min(y0, y1));
      expect(y).toBeLessThanOrEqual(Math.max(y0, y1));
      // Any turn back over the columns it left happens within a row pad of the waiting bar, not beside the leaving one.
      if (x < x0) expect(Math.abs(y - y1)).toBeLessThanOrEqual(ROW_PAD);
    }
  }
  // The waiting bar spans 60..110 under the end at 100: a straight drop there, no turning back.
  const straight = points(dependencyPath(from, cases[1][1]));
  expect(straight.at(-1)![0]).toBe(100);
  expect(straight.every(([x]) => x === 100)).toBe(true);
});
