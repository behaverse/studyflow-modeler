import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import { moveSegment, segmentsOf } from '@canvas/interaction/segments.ts';
import { isOrthogonal } from '@canvas/routing/orthogonal.ts';
import type { Point, SceneEdge, SceneNode } from '@canvas/model/scene.ts';

import { freshModdle, loadCanvas, dragBy, type Loaded } from './canvasHarness';

/**
 * Segment moves — parity spec §2 ("the big missing piece"), §3 (add a bend by
 * dragging a run's body) and §4 (orthogonal preservation + cropping), i.e. the port
 * of diagram-js's `ConnectionSegmentMove`.
 *
 * The whole story of `edge-videos/v1` is here: a straight flow dragged downwards
 * grows the source-bottom → across → target-bottom detour of `frame_03` (which is
 * §3's "add a bendpoint by dragging the segment"), and dragging that detour flat
 * again collapses it back to the straight two-point edge of `frame_09`. Both are
 * driven through the REAL pointer loop, so the gesture wiring — grip hit-testing,
 * the `'segment'` intent, `Drag.startSegment`, the writeback — is under test and
 * not just the geometry.
 *
 * Driven through `tests/canvasHarness.ts`, same setup as the other `canvas-*` specs.
 */

/**
 * Two tasks on one centre line, joined by an exactly straight flow: `Task_1` spans
 * x 200…300, `Task_2` x 400…500, both y 80…160, and `Flow_1` runs (300,120) →
 * (400,120). Round numbers all the way through, so every expectation below is the
 * literal geometry rather than an approximation.
 */
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:task id="Task_1" name="One"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Task_2" name="Two"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Task_1" targetRef="Task_2" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="400" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="300" y="120" /><di:waypoint x="400" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(xml = FIXTURE_XML): Promise<Loaded> {
  return loadCanvas(xml);
}

function diEdge(definitions: any, id: string): any {
  for (const diagram of definitions.diagrams ?? []) {
    for (const pe of diagram.plane?.planeElement ?? []) {
      if (pe.$type === 'bpmndi:BPMNEdge' && pe.bpmnElement?.id === id) return pe;
    }
  }
  return undefined;
}

function diWaypoints(definitions: any, id: string): Point[] {
  return (diEdge(definitions, id)?.waypoint ?? []).map((w: any) => ({ x: w.x, y: w.y }));
}

function edge(canvas: Canvas, id: string): SceneEdge {
  return canvas.getScene()!.elementsById.get(id) as SceneEdge;
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function points(edge: SceneEdge): Point[] {
  return edge.waypoints.map((p) => ({ x: p.x, y: p.y }));
}

/** The midpoint of run `index` — where its grip is drawn and grabbed. */
function segmentMid(edge: SceneEdge, index: number): Point {
  const segment = segmentsOf(edge.waypoints).find((s) => s.index === index)!;
  return { x: segment.mid.x, y: segment.mid.y };
}

// --- the v1 recording, both directions ---------------------------------------

test("dragging a horizontal run's grip slides it vertically and keeps every segment axis-aligned", async () => {
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_1');

  dragBy(canvas, segmentMid(flow, 0), { x: 350, y: 180 });

  // Source bottom → down → across → up into the target's bottom (`v1/frame_03`).
  expect(points(flow)).toEqual([
    { x: 250, y: 160 },
    { x: 250, y: 180 },
    { x: 450, y: 180 },
    { x: 450, y: 160 },
  ]);
  expect(isOrthogonal(flow.waypoints)).toBe(true);
});

test('a terminal run gains a joint rather than undocking the endpoint', async () => {
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_1');
  const source = node(canvas, 'Task_1');
  const target = node(canvas, 'Task_2');

  dragBy(canvas, segmentMid(flow, 0), { x: 350, y: 180 });

  // Two points became four: the run that moved could not take its docked ends with
  // it, so each grew a stub on its shape's mid-line.
  expect(flow.waypoints).toHaveLength(4);
  const first = flow.waypoints[0];
  const last = flow.waypoints[flow.waypoints.length - 1];
  expect(first).toEqual({ x: source.x + source.width / 2, y: source.y + source.height });
  expect(last).toEqual({ x: target.x + target.width / 2, y: target.y + target.height });
});

test('dragging a run flat collapses it back to a straight two-point edge', async () => {
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_1');

  dragBy(canvas, segmentMid(flow, 0), { x: 350, y: 180 });
  expect(flow.waypoints).toHaveLength(4);

  // …and back up again (`v1/frame_09`): the joints land inside their shapes, so the
  // re-dock drops them and the edge is straight once more.
  dragBy(canvas, segmentMid(flow, 1), { x: 350, y: 120 });

  expect(points(flow)).toEqual([{ x: 300, y: 120 }, { x: 400, y: 120 }]);
});

test('the moved waypoints are written to di:waypoint and round-trip through bpmn-moddle', async () => {
  const loaded = await load();
  const { canvas, definitions, moddle } = loaded;
  const flow = edge(canvas, 'Flow_1');
  const scene = canvas.getScene()!;
  const revision = scene.revision;

  dragBy(canvas, segmentMid(flow, 0), { x: 350, y: 180 });

  const expected = [
    { x: 250, y: 160 },
    { x: 250, y: 180 },
    { x: 450, y: 180 },
    { x: 450, y: 160 },
  ];
  // The LIVE moddle tree, mutated in place — one gesture, one revision bump.
  expect(diWaypoints(definitions, 'Flow_1')).toEqual(expected);
  expect(scene.revision).toBe(revision + 1);

  const { xml } = await moddle.toXML(definitions);
  expect(xml).toContain('<di:waypoint x="250" y="180" />');
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  expect(diWaypoints(reloaded, 'Flow_1')).toEqual(expected);
});

test('a press on a run BODY reshapes the edge as its grip would (parity spec §3)', async () => {
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_1');

  // Not the midpoint: an arbitrary point on the line, well clear of both the grip
  // box and either bendpoint.
  dragBy(canvas, { x: 320, y: 120 }, { x: 320, y: 180 });

  expect(points(flow)).toEqual([
    { x: 250, y: 160 },
    { x: 250, y: 180 },
    { x: 450, y: 180 },
    { x: 450, y: 160 },
  ]);
});

test('an unselected connection is selected and reshaped by the same gesture', async () => {
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_1');
  expect(canvas.getSelection().get()).toEqual([]);

  dragBy(canvas, segmentMid(flow, 0), { x: 350, y: 180 });

  expect(canvas.getSelection().get().map((e) => e.id)).toEqual(['Flow_1']);
  expect(flow.waypoints).toHaveLength(4);
});

// --- the geometry on its own -------------------------------------------------

test('moveSegment ignores the motion ALONG the run it is moving', async () => {
  const path = [{ x: 300, y: 120 }, { x: 400, y: 120 }];
  const straightDown = moveSegment(path, 0, { x: 0, y: 60 });
  const alsoSideways = moveSegment(path, 0, { x: 250, y: 60 });
  expect(alsoSideways).toEqual(straightDown);
});

test('a vertical run travels sideways, taking its two joints with it', async () => {
  const path = [
    { x: 250, y: 160 },
    { x: 250, y: 220 },
    { x: 450, y: 220 },
    { x: 450, y: 160 },
  ];
  // Run 1 is the horizontal one; runs 0 and 2 are the vertical stubs.
  const moved = moveSegment(path, 1, { x: 0, y: -40 });
  expect(moved[1].y).toBe(180);
  expect(moved[2].y).toBe(180);
  expect(isOrthogonal(moved)).toBe(true);

  // Moving the vertical stub sideways with no shapes to dock against keeps the
  // endpoint and grows a joint, exactly as the horizontal case does.
  expect(moveSegment(path, 0, { x: 30, y: 0 })).toEqual([
    { x: 250, y: 160 },
    { x: 280, y: 160 },
    { x: 280, y: 220 },
    { x: 450, y: 220 },
    { x: 450, y: 160 },
  ]);
});

test('without shapes a terminal run keeps its endpoint and grows a joint', async () => {
  const moved = moveSegment([{ x: 300, y: 120 }, { x: 400, y: 120 }], 0, { x: 0, y: 40 });
  expect(moved).toEqual([
    { x: 300, y: 120 },
    { x: 300, y: 160 },
    { x: 400, y: 160 },
    { x: 400, y: 120 },
  ]);
  expect(isOrthogonal(moved)).toBe(true);
});
