import { expect, test } from '@playwright/test';

import type { Canvas } from '@canvas/index.ts';
import { APPEND_DISTANCE, appendPosition } from '@canvas/interaction/autoplace.ts';
import type { Bounds, Point, SceneEdge, SceneNode } from '@canvas/model/scene.ts';

import { loadCanvas } from './canvasHarness';

/**
 * Click-append and its placement solver (P6b §3A, `interaction/autoplace.ts`).
 *
 * The contract is the one bpmn-js's `AutoPlace` + `BpmnAutoPlaceUtil` state: a
 * clicked append needs no pointer, so the editor picks the spot — one fixed gap to
 * the right of the source, vertically centred on it — mints the successor there and
 * connects the two, writing BOTH halves (business object + DI) for each, exactly as
 * a dropped shape and a dragged connection would.
 */

/** A start event, a task, and an end event — three appendability verdicts in one file. */
const PROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_1" name="Task" />
    <bpmn:endEvent id="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="600" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(): Promise<{ canvas: Canvas; definitions: any }> {
  return loadCanvas(PROCESS_XML);
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
const CROWDED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:task id="Task_1" name="Task" />
    <bpmn:task id="Blocker_1" name="Blocker" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Blocker_1_di" bpmnElement="Blocker_1">
        <dc:Bounds x="330" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

/** The edge joining two elements, whichever direction it was drawn in. */
function edgeBetween(canvas: Canvas, sourceId: string, targetId: string): SceneEdge | undefined {
  for (const element of canvas.getScene()!.elementsById.values()) {
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

/** The live plane's DI children, which is what `bpmn-moddle` re-serializes. */
function planeElements(definitions: any): any[] {
  return definitions.diagrams[0].plane.planeElement ?? [];
}

/** A start event with nothing around it: the first append lands in the row, unnudged. */
const SOLO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** A pool with two lanes: every append slot is enclosed by two container nodes. */
const POOL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_1" name="Pool" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Top" name="Top" />
    </bpmn:laneSet>
    <bpmn:task id="Task_Top" name="Top task" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Top_di" bpmnElement="Lane_Top" isHorizontal="true">
        <dc:Bounds x="30" y="0" width="570" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Top_di" bpmnElement="Task_Top">
        <dc:Bounds x="200" y="20" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test.describe('auto-place (click-append)', () => {
  test('appendPosition is one gap right of the source and vertically centred on it', () => {
    // Pure geometry, so it can be asserted without a canvas at all: the CENTRE of a
    // 36x36 event appended from a 100x80 task at (200, 80).
    const at = appendPosition({ x: 200, y: 80, width: 100, height: 80 }, { width: 36, height: 36 });
    expect(at).toEqual({ x: 200 + 100 + APPEND_DISTANCE + 18, y: 120 });
    expect(APPEND_DISTANCE).toBe(50);
  });

  test('appends the shape and the flow that reaches it, both written to the document', async () => {
    const { canvas, definitions } = await load();
    const source = node(canvas, 'Task_1');

    const appended = canvas.appendElement(source, { type: 'bpmn:EndEvent' });
    expect(appended).toBeTruthy();

    // Placed, not stacked: left edge one gap past the source's right edge, centres level.
    expect(appended!.x).toBe(source.x + source.width + APPEND_DISTANCE);
    expect(appended!.y + appended!.height / 2).toBe(source.y + source.height / 2);

    // The business object landed in the process...
    const process = definitions.rootElements.find((r: any) => r.$type === 'bpmn:Process');
    const flowElements = process.flowElements ?? [];
    expect(flowElements.some((f: any) => f.id === appended!.id)).toBe(true);

    // ...with a sequence flow from the source to it, wired both ways.
    const flow = flowElements.find(
      (f: any) => f.$type === 'bpmn:SequenceFlow' && f.targetRef?.id === appended!.id,
    );
    expect(flow).toBeTruthy();
    expect(flow.sourceRef.id).toBe('Task_1');

    // ...and DI for both halves, which is what makes the append survive a round-trip.
    const di = planeElements(definitions);
    expect(di.some((pe: any) => pe.$type === 'bpmndi:BPMNShape' && pe.bpmnElement?.id === appended!.id)).toBe(true);
    expect(di.some((pe: any) => pe.$type === 'bpmndi:BPMNEdge' && pe.bpmnElement?.id === flow.id)).toBe(true);
  });

  test('leaves the appended SHAPE selected, not the flow that was drawn to it', async () => {
    const { canvas } = await load();
    const appended = canvas.appendElement(node(canvas, 'Start_1'), { type: 'bpmn:Task' });

    expect(canvas.getSelection().get()).toEqual([appended]);
  });

  test('refuses to append from an end event, writing nothing at all', async () => {
    const { canvas, definitions } = await load();
    const before = (definitions.rootElements.find((r: any) => r.$type === 'bpmn:Process').flowElements ?? []).length;

    // `shape.append` is false for an end event (nothing may follow it), and the
    // gate is asked BEFORE the shape is minted — otherwise a refused connection
    // would leave an orphan behind.
    expect(canvas.appendElement(node(canvas, 'End_1'), { type: 'bpmn:Task' })).toBeUndefined();

    const after = (definitions.rootElements.find((r: any) => r.$type === 'bpmn:Process').flowElements ?? []).length;
    expect(after).toBe(before);
  });

  test('carries the palette descriptor through: extension type and attributes survive', async () => {
    const { canvas, definitions } = await load();
    const appended = canvas.appendElement(node(canvas, 'Task_1'), {
      type: 'bpmn:Task',
      attrs: { name: 'Appended' },
    });

    expect(appended).toBeTruthy();
    const process = definitions.rootElements.find((r: any) => r.$type === 'bpmn:Process');
    const bo = (process.flowElements ?? []).find((f: any) => f.id === appended!.id);
    expect(bo.name).toBe('Appended');
  });

  test('an occupied slot is nudged past, not silently dropped', async () => {
    const { canvas } = await loadCanvas(CROWDED_XML);
    const source = node(canvas, 'Task_1');
    const blocker = node(canvas, 'Blocker_1');

    const appended = canvas.appendElement(source, { type: 'bpmn:EndEvent' });

    expect(appended, 'the append happened at all').toBeTruthy();
    // Same lane as always — only the row moved.
    expect(appended!.x).toBe(source.x + source.width + APPEND_DISTANCE);
    expect(appended!.y).toBeGreaterThan(blocker.y + blocker.height);

    // And it fell far enough that the router's elbow points DOWN out of the source
    // rather than sideways through the blocker (see `verticalEscape`).
    const dx = Math.abs((appended!.x + appended!.width / 2) - (source.x + source.width / 2));
    const dy = Math.abs((appended!.y + appended!.height / 2) - (source.y + source.height / 2));
    expect(dy).toBeGreaterThan(dx);
  });

  test('appending twice from one source fans out instead of stacking', async () => {
    const { canvas } = await load();
    const source = node(canvas, 'Task_1');

    const first = canvas.appendElement(source, { type: 'bpmn:Task' });
    const second = canvas.appendElement(source, { type: 'bpmn:Task' });

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
  });

  test('the hover ghost shows the slot the click will actually take', async () => {
    const { canvas } = await loadCanvas(CROWDED_XML);
    const source = node(canvas, 'Task_1');

    // A preview that pointed at the original, blocked slot would be a lie.
    const preview = canvas.previewAppend(source, { type: 'bpmn:EndEvent' });
    canvas.clearAppendPreview();
    const appended = canvas.appendElement(source, { type: 'bpmn:EndEvent' });

    expect(preview).toBeTruthy();
    expect({ x: preview!.x, y: preview!.y }).toEqual({ x: appended!.x, y: appended!.y });
  });

  test('the second flow is not hidden under the first successor', async () => {
    // The report: append twice from a start event and the second flow "is not
    // visible as it's under the first created task and edge". The router bends a
    // diagonal pair along the DOMINANT axis, so while the drop is nearer than it is
    // lower the flow sets off sideways at the source's own y — straight through the
    // sibling. The placement has to fall far enough for the elbow to flip.
    const { canvas } = await loadCanvas(SOLO_XML);
    const source = node(canvas, 'Start_1');

    const first = canvas.appendElement(source, { type: 'bpmn:Task' })!;
    const second = canvas.appendElement(source, { type: 'bpmn:Task' })!;
    const flow = edgeBetween(canvas, source.id, second.id);

    // The first one is unnudged — this is the plain two-appends-in-a-row case.
    expect(first.y + first.height / 2).toBe(source.y + source.height / 2);

    expect(flow, 'the second flow exists').toBeTruthy();
    for (const [a, b] of segments(flow!.waypoints)) {
      expect(
        crosses(a, b, first),
        `segment (${a.x},${a.y})-(${b.x},${b.y}) runs through the first successor`,
      ).toBe(false);
    }
  });

  test('an annotation nudges UP, away from the source it hangs over', async () => {
    // Its slot is ABOVE the source, so stepping "down" walks it into the source.
    const { canvas } = await load();
    const source = node(canvas, 'Task_1');

    const first = canvas.appendElement(source, { type: 'bpmn:TextAnnotation' })!;
    const second = canvas.appendElement(source, { type: 'bpmn:TextAnnotation' })!;

    expect(second.y).toBeLessThan(first.y);
    expect(second.y + second.height).toBeLessThanOrEqual(source.y);
  });

  test('a container is not an obstacle: an append inside a pool keeps its row', async () => {
    // The lane a successor lands in is enclosed by a pool AND a lane, both of which
    // intersect every candidate slot. Counting either as occupancy would report all
    // ten probes taken and drop the append back on the blocked fallback position.
    const { canvas } = await loadCanvas(POOL_XML);
    const source = node(canvas, 'Task_Top');

    const appended = canvas.appendElement(source, { type: 'bpmn:Task' });

    expect(appended, 'the append happened inside the pool').toBeTruthy();
    expect(appended!.x).toBe(source.x + source.width + APPEND_DISTANCE);
    // Same row as the source: nothing was in the way, so nothing was nudged.
    expect(appended!.y).toBe(source.y);
  });
});
