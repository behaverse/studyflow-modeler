import { expect, test } from '@playwright/test';

import type { Canvas } from '@canvas/index.ts';

import { diOf, loadYaml, node, pointerDown, pointerMove, pointerUp } from './canvasHarness';

/**
 * The two snaps a move runs under, and how they compose, axis by axis:
 *
 * - within the 7-unit tolerance the dragged shape's centre lands exactly on a
 *   neighbour's, on the grid or off it, and a guide is drawn along that alignment;
 * - beyond it the axis falls through to the 10-unit grid, and no guide is drawn;
 * - the two verdicts are independent, so one axis can align while the other steps.
 *
 * Under jsdom the viewport maps screen to diagram 1:1, so a pointer event's client
 * coordinates round-trip exactly.
 */

/**
 * Two shapes far enough apart that a drag between them is unambiguous, and an end
 * event whose centre sits at (418, 123), off the 10-unit grid on `y`: a shape pulled
 * onto that centre shows alignment beat the grid rather than merely agreeing with it.
 */
const FIXTURE_YAML = `id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    Task_1:
      type: Task
      name: Task
      bounds: 200 80 100 80
    End_1:
      type: EndEvent
      bounds: 400 105 36 36
`;

/** The snap guides on screen, each as the line it draws: `x=418` is vertical, `y=123` horizontal. */
function guides(canvas: Canvas): string[] {
  return Array.from(canvas.getSvg().querySelectorAll('.sf-snap-line')).map((line) => (
    line.getAttribute('x1') === line.getAttribute('x2') ? `x=${line.getAttribute('x1')}` : `y=${line.getAttribute('y1')}`
  ));
}

test('a move aligns each axis with a neighbour\'s centre within 7 units, else lands on the grid', async () => {
  // Task_1's centre starts at (250, 120); End_1's is (418, 123).
  const CASES: [label: string, to: { x: number; y: number }, landed: { x: number; y: number }, drawn: string[]][] = [
    // 123 is off the grid: had the grid had the last word, the two would not be level.
    ['4 right and 3 below the end event\'s centre: onto it on both axes', { x: 422, y: 126 }, { x: 368, y: 83 }, ['x=418', 'y=123']],
    ['(+33, +17), near nothing: the grid on both axes', { x: 283, y: 137 }, { x: 230, y: 100 }, []],
    ['2 above its centre line, x near nothing: level on y, the grid on x', { x: 287, y: 121 }, { x: 240, y: 83 }, ['y=123']],
  ];
  for (const [label, to, landed, drawn] of CASES) {
    const { canvas, definitions } = loadYaml(FIXTURE_YAML);
    const task = node(canvas, 'Task_1');
    pointerDown(canvas, { x: 250, y: 120 });
    pointerMove(canvas, to);
    expect({ x: task.x, y: task.y }, label).toEqual(landed);
    expect(guides(canvas), label).toEqual(drawn);

    // What was on screen is what is committed, DI included, and the guides go with the gesture.
    pointerUp(canvas, to);
    canvas.syncDi();
    expect(diOf(definitions, 'Task_1').bounds, label).toMatchObject(landed);
    expect(guides(canvas), label).toEqual([]);
  }
});
