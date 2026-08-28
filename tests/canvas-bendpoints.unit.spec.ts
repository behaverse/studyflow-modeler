import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import { isOrthogonal } from '@canvas/routing/orthogonal.ts';
import type { Point, SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';

import { loadCanvas, jsdomWindow, dragBy } from './canvasHarness';

/**
 * A connection's OVERLAY — parity spec §1 (a blue handle on every waypoint, both
 * endpoints included) and §2 (a move grip on the straight run the pointer HOVERS,
 * following the pointer along it — `ns` on a horizontal run and `ew` on a vertical
 * one, as `edge-videos/v2/frame_10` shows). Bendpoints appear for a SELECTED
 * connection and for a merely HOVERED one, and everything disappears under a
 * multi-selection, which is diagram-js's rule.
 *
 * Also home to the plane-scope seam (`Canvas.setPlaneScope`), because it is the
 * same question asked of the canvas: what is on screen, and what may be grabbed.
 */

const win = jsdomWindow();

/**
 * One flow with a genuine Z shape: (300,120) → (350,120) → (350,280) → (400,280),
 * i.e. three straight runs — horizontal, vertical, horizontal — each long enough to
 * carry a grip.
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
        <dc:Bounds x="400" y="240" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="300" y="120" /><di:waypoint x="350" y="120" />
        <di:waypoint x="350" y="280" /><di:waypoint x="400" y="280" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(xml = FIXTURE_XML): Promise<Canvas> {
  const { canvas } = await loadCanvas(xml);
  return canvas;
}

function edge(canvas: Canvas, id: string): SceneEdge {
  return canvas.getScene()!.elementsById.get(id) as SceneEdge;
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function chrome(canvas: Canvas, selector: string): Element[] {
  return Array.from(canvas.getSvg().querySelectorAll(selector));
}

/** The `translate(x, y)` a chrome node was placed at. */
function placedAt(element: Element): Point {
  const match = /translate\(([-\d.]+), ([-\d.]+)\)/.exec(element.getAttribute('transform') ?? '');
  return { x: Number(match?.[1]), y: Number(match?.[2]) };
}

/** A hover: a `pointermove` fired on the SVG itself, which the local shim keeps. */
function firePointer(canvas: Canvas, target: EventTarget, type: string, diagram: Point): void {
  const screen = canvas.getViewport().toScreen(diagram);
  target.dispatchEvent(new win.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: screen.x,
    clientY: screen.y,
    button: 0,
  }));
}

// --- bendpoints --------------------------------------------------------------

test('a selected connection draws a handle at every waypoint including both endpoints', async () => {
  const canvas = await load();
  const flow = edge(canvas, 'Flow_1');
  canvas.getSelection().select(flow);

  const dots = chrome(canvas, '.sf-bendpoint');
  expect(dots).toHaveLength(flow.waypoints.length);
  expect(dots.map(placedAt)).toEqual(flow.waypoints.map((p) => ({ x: p.x, y: p.y })));
  // The endpoints are handles like any other — that is what makes them draggable.
  expect(dots[0].getAttribute('data-waypoint')).toBe('0');
  expect(dots[dots.length - 1].getAttribute('data-waypoint')).toBe('3');
});

test('a hovered connection draws the same handles', async () => {
  const canvas = await load();
  const flow = edge(canvas, 'Flow_1');
  expect(chrome(canvas, '.sf-bendpoint')).toHaveLength(0);

  // Pointer over the middle of the vertical run — hover only, no press.
  firePointer(canvas, canvas.getSvg(), 'pointermove', { x: 350, y: 200 });

  expect(canvas.getSelection().get()).toEqual([]);
  expect(chrome(canvas, '.sf-bendpoint')).toHaveLength(flow.waypoints.length);
});

test('a multi-selection draws no edge chrome at all', async () => {
  const canvas = await load();
  canvas.getSelection().select([edge(canvas, 'Flow_1'), node(canvas, 'Task_1')]);

  expect(chrome(canvas, '.sf-bendpoint')).toHaveLength(0);
  expect(chrome(canvas, '.sf-segment-grip')).toHaveLength(0);
});

// --- segment grips -----------------------------------------------------------

test('the grip appears on the hovered run only, and follows the pointer along it', async () => {
  const canvas = await load();
  canvas.getSelection().select(edge(canvas, 'Flow_1'));

  // Selected but not hovered: bendpoints only, no grips anywhere.
  expect(chrome(canvas, '.sf-segment-grip')).toHaveLength(0);

  // Hover partway down the vertical run (a few units off its line still counts):
  // ONE grip, ew, at the pointer's projection onto the run — not at its midpoint.
  firePointer(canvas, canvas.getSvg(), 'pointermove', { x: 353, y: 170 });
  let grips = chrome(canvas, '.sf-segment-grip');
  expect(grips).toHaveLength(1);
  expect(grips[0].getAttribute('data-segment')).toBe('1');
  expect(grips[0].classList.contains('sf-segment-grip-ew')).toBe(true);
  expect(placedAt(grips[0])).toEqual({ x: 350, y: 170 });

  // It travels with the pointer along the same run…
  firePointer(canvas, canvas.getSvg(), 'pointermove', { x: 350, y: 220 });
  expect(placedAt(chrome(canvas, '.sf-segment-grip')[0])).toEqual({ x: 350, y: 220 });

  // …and hovering the first horizontal run offers THAT run's ns grip instead.
  firePointer(canvas, canvas.getSvg(), 'pointermove', { x: 320, y: 120 });
  grips = chrome(canvas, '.sf-segment-grip');
  expect(grips).toHaveLength(1);
  expect(grips[0].getAttribute('data-segment')).toBe('0');
  expect(grips[0].classList.contains('sf-segment-grip-ns')).toBe(true);
  // The glyph is a pair of triangles with a CHANNEL between them (`v2/frame_10`):
  // one tip 8 units above the run, the other 8 below, neither base closer than 3 —
  // a 6-unit gap, without which the pair closes up into one solid diamond.
  expect(grips[0].querySelector('.sf-segment-grip-visual')?.getAttribute('d'))
    .toBe('M 0 -8 L -3.5 -3 L 3.5 -3 Z M 0 8 L -3.5 3 L 3.5 3 Z');
  expect(grips[0].querySelector('.sf-segment-grip-hit')?.getAttribute('width')).toBe('20');

  // Inside a bendpoint's reach the joint's own handle wins: no grip on offer.
  firePointer(canvas, canvas.getSvg(), 'pointermove', { x: 350, y: 126 });
  expect(chrome(canvas, '.sf-segment-grip')).toHaveLength(0);
});

test('a merely hovered connection offers the grip too, and a run shorter than the grip gets none', async () => {
  const canvas = await load();
  firePointer(canvas, canvas.getSvg(), 'pointermove', { x: 350, y: 200 });
  expect(canvas.getSelection().get()).toEqual([]);
  const grips = chrome(canvas, '.sf-segment-grip');
  expect(grips).toHaveLength(1);
  expect(grips[0].getAttribute('data-segment')).toBe('1');

  // Shrink the middle run below the grip's own length: hovering it offers nothing.
  const flow = edge(canvas, 'Flow_1');
  flow.waypoints = [
    { x: 300, y: 120 },
    { x: 350, y: 120 },
    { x: 350, y: 130 },
    { x: 400, y: 130 },
  ];
  canvas.redrawElements([flow]);
  firePointer(canvas, canvas.getSvg(), 'pointermove', { x: 350, y: 125 });
  expect(chrome(canvas, '.sf-segment-grip')).toHaveLength(0);
});

// --- bendpoint drags move one joint, and one joint only ----------------------

test('dragging a middle bendpoint moves it alone — its neighbours stay put and the runs go diagonal', async () => {
  const canvas = await load();
  const flow = edge(canvas, 'Flow_1');
  canvas.getSelection().select(flow);

  // Grab the second waypoint (the top corner of the Z) and pull it right and down.
  dragBy(canvas, { x: 350, y: 120 }, { x: 380, y: 150 });

  // The joint went exactly where the pointer let go; its interior neighbour did
  // not follow, so the edge is now genuinely bent out of Manhattan.
  expect(flow.waypoints).toHaveLength(4);
  expect(flow.waypoints[1]).toEqual({ x: 380, y: 150 });
  expect(flow.waypoints[2]).toEqual({ x: 350, y: 280 });
  expect(isOrthogonal(flow.waypoints)).toBe(false);
});

// --- the plane-scope seam ----------------------------------------------------

test('a scope predicate hides rejected elements and removes them from hit-testing', async () => {
  const canvas = await load();
  const target = node(canvas, 'Task_2');
  expect(canvas.hitTest({ x: 450, y: 280 })?.id).toBe('Task_2');

  const inScope = (element: SceneElement): boolean => element.id !== 'Task_2';
  canvas.setPlaneScope(inScope);

  expect(canvas.getPlaneScope()).toBe(inScope);
  expect(canvas.getGraphics('Task_2')?.getAttribute('display')).toBe('none');
  expect(canvas.hitTest({ x: 450, y: 280 })).toBeUndefined();
  expect(canvas.elementAt({ x: 450, y: 280 })).toBeUndefined();
  // Everything else is untouched.
  expect(canvas.hitTest({ x: 250, y: 120 })?.id).toBe('Task_1');
  expect(canvas.getGraphics('Task_1')?.getAttribute('display')).toBeNull();

  // Dropping the scope puts it back — drawn, and clickable again.
  canvas.setPlaneScope(undefined);
  expect(canvas.getGraphics('Task_2')?.getAttribute('display')).toBeNull();
  expect(canvas.hitTest({ x: 450, y: 280 })?.id).toBe('Task_2');
  expect(target.x).toBe(400);
});

test('a plane scope writes nothing and clears the selection', async () => {
  const canvas = await load();
  const scene = canvas.getScene()!;
  const revision = scene.revision;
  canvas.getSelection().select(node(canvas, 'Task_2'));

  canvas.setPlaneScope((element) => element.id !== 'Task_2');

  expect(canvas.getSelection().get()).toEqual([]);
  expect(scene.revision).toBe(revision);
});
