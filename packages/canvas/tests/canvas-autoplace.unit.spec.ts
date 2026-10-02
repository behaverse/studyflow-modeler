import { expect, test } from '@playwright/test';

import type { Canvas, NewShape } from '@canvas/index.ts';
import { APPEND_DISTANCE } from '@canvas/study/autoplace.ts';
import type { Bounds, Point, SceneEdge, SceneNode } from '@canvas/study/scene.ts';
import type { Element } from '@core/model/index';

import { edge, loadYaml, node, savedDrawing, sceneOf, type Loaded } from './canvasHarness';

/**
 * Click-append (`study/autoplace.ts`). A clicked append needs no pointer, so the
 * canvas picks the spot — one fixed gap to the right of the source, vertically centred
 * on it, stepped past whatever occupies it — mints the successor there and connects
 * the two, writing the business objects and the DI as a dropped shape and a drawn
 * connection would.
 */

/** A start event, a task, and an end event — three appendability verdicts in one file. */
const PROCESS_YAML = `id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    Start_1:
      type: StartEvent
      bounds: 100 100 36 36
    Task_1:
      type: Task
      name: Task
      bounds: 200 80 100 80
    End_1:
      type: EndEvent
      bounds: 600 100 36 36
`;

function load(): Loaded {
  return loadYaml(PROCESS_YAML);
}

/**
 * `Task_1` with its append slot ALREADY OCCUPIED: `Blocker_1` straddles x 330-430,
 * and a successor appended from `Task_1` wants to start at x 350.
 *
 * This is the shape of a real report — "appending does nothing when another element
 * is near, but works after I move the source to empty space". `Create.createAt`
 * hit-tests the drop centre, a centre over a task resolves to "a task inside a
 * task", the rules refuse it, and the append is dropped with no feedback.
 */
const CROWDED_YAML = `id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    Task_1:
      type: Task
      name: Task
      bounds: 200 80 100 80
    Blocker_1:
      type: Task
      name: Blocker
      bounds: 330 80 100 80
`;

/** The edge joining two elements, whichever direction it was drawn in. */
/** Click-append `what` from `source`, as the context pad does: the shape made, or nothing when refused. */
function appendFrom(canvas: Canvas, source: SceneNode, what: NewShape): SceneNode | undefined {
  const { id } = canvas.append(source.id, what);
  return id === undefined ? undefined : node(canvas, id);
}

function edgeBetween(canvas: Canvas, sourceId: string, targetId: string): SceneEdge | undefined {
  for (const element of sceneOf(canvas).elementsById.values()) {
    if (element.kind !== 'edge') continue;
    const edge = element as SceneEdge;
    if (edge.source?.id === sourceId && edge.target?.id === targetId) return edge;
  }
  return undefined;
}

function segments(waypoints: readonly Point[]): [Point, Point][] {
  return waypoints.slice(1).map((point, i) => [waypoints[i], point] as [Point, Point]);
}

/**
 * Whether the axis-aligned segment `a`-`b` passes through `box`.
 *
 * Strict on both sides: an edge that ENDS on a shape's outline touches the box
 * without running through it, and every routed endpoint does exactly that.
 */
function crosses(a: Point, b: Point, box: Bounds): boolean {
  const spans = (lo: number, hi: number, from: number, to: number): boolean =>
    Math.min(from, to) < hi && Math.max(from, to) > lo;
  return spans(box.x, box.x + box.width, a.x, b.x)
    && spans(box.y, box.y + box.height, a.y, b.y);
}

/** A start event with nothing around it: the first append lands in the row, unnudged. */
const SOLO_YAML = `id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    Start_1:
      type: StartEvent
      bounds: 100 100 36 36
`;

/** A pool with two lanes: every append slot is enclosed by two container nodes. */
const POOL_YAML = `id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Collab_1:
  type: Collaboration
  participants:
    Pool_1:
      name: Pool
      processRef: Process_1
      bounds: 0 0 600 250
      isHorizontal: true
Process_1:
  type: Process
  laneSets:
    LaneSet_1:
      lanes:
        Lane_Top:
          name: Top
          bounds: 30 0 570 250
          isHorizontal: true
  flowElements:
    Task_Top:
      type: Task
      name: Top task
      bounds: 200 20 100 80
`;

test.describe('auto-place (click-append)', () => {
  test('appends the shape and the flow that reaches it, both written to the document, and selects the shape', async () => {
    const loaded = load();
    const { canvas } = loaded;
    const source = node(canvas, 'Task_1');

    const appended = appendFrom(canvas, source, { type: 'bpmn:EndEvent', name: 'Appended' });
    expect(appended).toBeTruthy();

    // Placed, not stacked: left edge one gap past the source's right edge, centres level.
    expect(appended!.x).toBe(source.x + source.width + APPEND_DISTANCE);
    expect(appended!.y + appended!.height / 2).toBe(source.y + source.height / 2);

    // The element landed in the process, carrying the descriptor's attributes...
    const { model } = canvas.study;
    const flowElements = (model.study.roots.find((r) => model.isA(r, 'bpmn:Process'))!.flowElements ?? []) as Element[];
    expect(flowElements.find((f) => f.id === appended!.id)?.name).toBe('Appended');

    // ...with a sequence flow from the source to it.
    const flow = flowElements.find((f) => f.type === 'bpmn:SequenceFlow' && f.targetRef === appended!.id)!;
    expect(flow).toBeTruthy();
    expect(flow.sourceRef).toBe('Task_1');

    // ...and a drawing for both halves, which is what makes the append survive a round-trip.
    expect(savedDrawing(loaded, appended!.id)?.bounds).toBeTruthy();
    expect(savedDrawing(loaded, flow.id!)?.waypoint).toBeTruthy();

    // The shape is what is left selected, not the flow drawn to it.
    expect(canvas.selection).toEqual([appended!.id]);
  });

  test('refuses to append from an end event, writing nothing at all', async () => {
    const { canvas } = load();
    const { model } = canvas.study;
    const flowCount = (): number => ((model.study.roots.find((r) => model.isA(r, 'bpmn:Process'))!.flowElements ?? []) as Element[]).length;
    const before = flowCount();

    // `shape.append` is false for an end event (nothing may follow it), and the
    // gate is asked BEFORE the shape is minted — otherwise a refused connection
    // would leave an orphan behind.
    expect(appendFrom(canvas, node(canvas, 'End_1'), { type: 'bpmn:Task' })).toBeUndefined();

    const after = flowCount();
    expect(after).toBe(before);
  });

  test('an occupied slot is nudged below in its column, and the flow into it runs clear of what holds the slot', async () => {
    // Behind the second row, a report: append twice from a start event and the second flow "is not visible as it's
    // under the first created task and edge". The router bends a diagonal pair along the DOMINANT axis, so while the
    // drop is nearer than it is lower the flow sets off sideways at the source's own y, straight through the holder.
    const CASES: [label: string, yaml: string, from: string, type: string, holder: (canvas: Canvas, source: SceneNode) => SceneNode][] = [
      ['a shape drawn there', CROWDED_YAML, 'Task_1', 'bpmn:EndEvent', (canvas) => node(canvas, 'Blocker_1')],
      ['the first successor', SOLO_YAML, 'Start_1', 'bpmn:Task', (canvas, source) => appendFrom(canvas, source, { type: 'bpmn:Task' })!],
    ];
    for (const [label, yaml, from, type, holder] of CASES) {
      const { canvas } = loadYaml(yaml);
      const source = node(canvas, from);
      const held = holder(canvas, source);

      const appended = appendFrom(canvas, source, { type });

      expect(appended, `${label}: the append happened at all`).toBeTruthy();
      expect(appended!.x, label).toBe(source.x + source.width + APPEND_DISTANCE);
      expect(appended!.y, label).toBeGreaterThanOrEqual(held.y + held.height);
      for (const [a, b] of segments(edgeBetween(canvas, source.id, appended!.id)!.waypoints)) {
        expect(crosses(a, b, held), `${label}: segment (${a.x},${a.y})-(${b.x},${b.y}) runs through the holder`).toBe(false);
      }
    }
  });

  test('an annotation hangs above its source, and the next one nudges further UP', async () => {
    // Its slot is ABOVE the source, so stepping "down" would walk it into the source.
    const { canvas } = load();
    const source = node(canvas, 'Task_1');

    const first = appendFrom(canvas, source, { type: 'bpmn:TextAnnotation' })!;
    const second = appendFrom(canvas, source, { type: 'bpmn:TextAnnotation' })!;

    expect(first.y + first.height).toBeLessThanOrEqual(source.y);
    expect(second.y).toBeLessThan(first.y);
    expect(second.y + second.height).toBeLessThanOrEqual(source.y);
  });

  test('a container is not an obstacle: an append inside a pool keeps its row', async () => {
    // The lane a successor lands in is enclosed by a pool AND a lane, both of which
    // intersect every candidate slot. Counting either as occupancy would report all
    // ten probes taken and drop the append back on the blocked fallback position.
    const { canvas } = loadYaml(POOL_YAML);
    const source = node(canvas, 'Task_Top');

    const appended = appendFrom(canvas, source, { type: 'bpmn:Task' });

    expect(appended, 'the append happened inside the pool').toBeTruthy();
    expect(appended!.x).toBe(source.x + source.width + APPEND_DISTANCE);
    // Same row as the source: nothing was in the way, so nothing was nudged.
    expect(appended!.y).toBe(source.y);
  });
});

test.describe('auto-place around a foreign container', () => {
  /**
   * A start event with an EXPANDED SUB-PROCESS occupying the slot to its right, the
   * way a reported diagram had it. A container is transparent
   * to hit-testing, so the successor used to be minted on top of `prepare_data` —
   * reparented into it by `Create.createAt`, and left unconnected, because a flow
   * from outside a sub-process to a node inside it is refused.
   */
  const SUBPROCESS_YAML = `id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    Start_1:
      type: StartEvent
      bounds: 100 200 36 36
    Sub_1:
      type: SubProcess
      name: prepare_data
      bounds: 180 100 350 250
      isExpanded: true
`;

  test('does not drop the successor inside a sub-process it has to pass', async () => {
    const { canvas } = loadYaml(SUBPROCESS_YAML);
    const source = node(canvas, 'Start_1');
    const sub = node(canvas, 'Sub_1');

    const appended = appendFrom(canvas, source, { type: 'bpmn:EndEvent' })!;

    expect(appended, 'the append happened').toBeTruthy();
    // Clear of the sub-process, and OUTSIDE it — not reparented into it.
    expect(appended.y).toBeGreaterThan(sub.y + sub.height);
    expect(appended.parent?.id).not.toBe('Sub_1');
    // And reached by a flow, which is what the drop inside the frame used to lose.
    expect(edgeBetween(canvas, source.id, appended.id), 'the flow was drawn').toBeTruthy();
  });

  test('the hover ghost shows the slot the click takes, stepped past what is in the way', async () => {
    // A ghost of the first, blocked slot would promise a placement the click does not make.
    const CASES: [label: string, yaml: string, source: string, type: string][] = [
      ['a task in the slot', CROWDED_YAML, 'Task_1', 'bpmn:EndEvent'],
      ['an expanded sub-process in the slot', SUBPROCESS_YAML, 'Start_1', 'bpmn:EndEvent'],
      ['an annotation, whose slot is above the source', PROCESS_YAML, 'Task_1', 'bpmn:TextAnnotation'],
    ];
    for (const [label, yaml, id, type] of CASES) {
      const { canvas } = loadYaml(yaml);
      const source = node(canvas, id);
      const preview = canvas.previewAppend(source.id, { type });
      canvas.clearAppendPreview();
      const appended = appendFrom(canvas, source, { type })!;
      expect({ x: preview!.x, y: preview!.y }, label).toEqual({ x: appended.x, y: appended.y });
    }
  });
});

test.describe('auto-place around edges', () => {
  /**
   * `Task_1`'s append slot is crossed by a sequence flow that has nothing to do with
   * it: `Up` → `Down` runs vertically at x 380, straight through the slot at x
   * 350-386. Nothing SHAPED is there, so the slot used to read as free and the
   * successor was minted on top of the line.
   */
  const CROSSED_YAML = `id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    Task_1:
      type: Task
      name: Task
      bounds: 200 80 100 80
    Up:
      type: Task
      name: Up
      bounds: 330 -180 100 80
    Down:
      type: Task
      name: Down
      bounds: 330 300 100 80
    Flow_1:
      sourceRef: Up
      targetRef: Down
      waypoint: 380,-100 380,300
`;

  test('a slot a flow runs through is occupied, shape or no shape', async () => {
    const { canvas } = loadYaml(CROSSED_YAML);
    const source = node(canvas, 'Task_1');

    const appended = appendFrom(canvas, source, { type: 'bpmn:EndEvent' })!;

    expect(appended, 'the append happened').toBeTruthy();
    for (const [a, b] of segments(edge(canvas, 'Flow_1').waypoints)) {
      expect(crosses(a, b, appended), 'the successor sits on the flow').toBe(false);
    }
  });
});
