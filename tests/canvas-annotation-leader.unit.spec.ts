import { expect, test } from '@playwright/test';

import { BPMN } from '@core/constants';
import type { Canvas } from '@canvas/index.ts';
import { markerEndFor } from '@canvas/render/renderer.ts';
import { isOrthogonal } from '@canvas/routing/orthogonal.ts';
import type { SceneEdge, SceneNode } from '@canvas/model/scene.ts';

import { freshModdle, loadCanvas, type Loaded } from './canvasHarness';

/**
 * The text-annotation LEADER (parity spec addendum 5 §1/§3, `edge-videos/preview/frame_08`).
 *
 * bpmn-js hangs a note off its subject on a slanted dotted line with no arrowhead —
 * `BpmnLayouter` runs the manhattan layout for sequence and message flows but leaves
 * a plain `bpmn:Association` as the line between the two mids, and BPMN's default
 * `associationDirection` of `None` means nothing is pointing anywhere. The canvas was
 * drawing it as an orthogonal L-bend wearing an open arrow: the right dash, the wrong
 * shape, and an arrow the notation does not have.
 *
 * Three things are pinned here, and they are one contract:
 *
 * 1. the COMMITTED association — geometry and marker, written through to `di:waypoint`
 *    and proved by re-serializing the same live `Definitions`;
 * 2. the HOVER GHOST the context pad draws, which must be the same geometry and the
 *    same marker as (1) — addendum 5 §3, "ghost and commit must agree";
 * 3. that an association which DOES declare a direction keeps its arrowhead, so this
 *    is a fix to the default case and not a blanket removal.
 */

/** One task, sitting on round numbers so the leader's endpoints are exact. */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_A" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_A" isExecutable="false">
    <bpmn:task id="Task_1" name="Subject" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_A">
    <bpmndi:BPMNPlane id="Plane_A" bpmnElement="Process_A">
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="200" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(): Promise<Loaded> {
  return loadCanvas(XML);
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

/** The single association in the scene. */
function association(canvas: Canvas): SceneEdge {
  const edges = [...canvas.getScene()!.elementsById.values()]
    .filter((el): el is SceneEdge => el.kind === 'edge' && el.type === BPMN.Association);
  expect(edges).toHaveLength(1);
  return edges[0];
}

function diEdge(definitions: any, id: string): any {
  return (definitions.diagrams[0].plane.planeElement ?? [])
    .find((pe: any) => pe.$type === 'bpmndi:BPMNEdge' && pe.bpmnElement?.id === id);
}

test('appending a text annotation mints a STRAIGHT, arrowless association — and toXML emits it', async () => {
  const loaded = await load();
  const { canvas, definitions } = loaded;
  const task = node(canvas, 'Task_1');

  const note = canvas.appendElement(task, { type: BPMN.TextAnnotation });
  expect(note).toBeDefined();

  const leader = association(canvas);
  expect(leader.source).toBe(task);
  expect(leader.target).toBe(note);

  // Two points, and they are NOT axis-aligned: the note sits above-right of its
  // subject and the leader simply runs there.
  expect(leader.waypoints).toHaveLength(2);
  expect(isOrthogonal(leader.waypoints)).toBe(false);

  // No arrowhead, and the dotted dash of an association.
  const line = canvas.getGraphics(leader.id)!.querySelector('.sf-connection-line')!;
  expect(line.getAttribute('marker-end')).toBeNull();
  expect(line.getAttribute('stroke-dasharray')).toBe('2,6');

  // The geometry is written THROUGH to the live DI, not just to the scene…
  const di = diEdge(definitions, leader.id);
  expect(di.waypoint.map((w: any) => ({ x: w.x, y: w.y }))).toEqual(leader.waypoints);

  // …so re-serializing the same tree emits the association and its two waypoints,
  // and a reload puts them back unchanged.
  const { xml } = await loaded.moddle.toXML(definitions);
  expect(xml).toContain('bpmn:association');
  expect(xml).toContain('bpmn:textAnnotation');
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  const reloadedDi = diEdge(reloaded, leader.id);
  expect(reloadedDi.waypoint).toHaveLength(2);
  expect(reloadedDi.waypoint.map((w: any) => ({ x: w.x, y: w.y }))).toEqual(leader.waypoints);
  // The notation's own default: nothing points anywhere, so nothing is serialized.
  const reloadedAssoc = reloaded.rootElements
    .find((el: any) => el.id === 'Process_A').artifacts
    .find((el: any) => el.id === leader.id);
  expect(reloadedAssoc.associationDirection).toBeUndefined();
});

test('the hover ghost draws the SAME leader the click would commit', async () => {
  // Addendum 5 §3: what the hover shows is where the click lands — which has to
  // include the shape of the line, not only the position of the box.
  const { canvas } = await load();
  const task = node(canvas, 'Task_1');

  expect(canvas.previewAppend(task, { type: BPMN.TextAnnotation })).toBeDefined();
  const ghost = canvas.getSvg().querySelector('.sf-append-preview-line')!;
  expect(ghost.getAttribute('marker-end')).toBeNull();
  expect(ghost.getAttribute('stroke-dasharray')).toBe('2,6');
  const ghostPoints = ghost.getAttribute('data-waypoints');

  canvas.clearAppendPreview();
  expect(canvas.hasAppendPreview()).toBe(false);

  canvas.appendElement(task, { type: BPMN.TextAnnotation });
  const committed = association(canvas).waypoints.map((p) => `${p.x},${p.y}`).join(' ');
  expect(ghostPoints).toBe(committed);
});

test('the annotation ghost is the whole box, not the bracket the committed shape wears', async () => {
  // `edge-videos/preview/frame_08` draws the hovered annotation as a closed blue
  // rectangle. Every other ghost IS the real visual, and that is right — but a
  // bracket shows neither the width of what is about to land nor where its right
  // edge falls, which is the one question a ghost exists to answer.
  const { canvas } = await load();
  const bounds = canvas.previewAppend(node(canvas, 'Task_1'), { type: BPMN.TextAnnotation })!;
  expect(bounds).toBeDefined();

  const ghost = canvas.getSvg().querySelector('.sf-append-preview .sf-dragger path')!;
  expect(ghost.getAttribute('d'))
    .toBe(`M0,0 L${bounds.width},0 L${bounds.width},${bounds.height} L0,${bounds.height} Z`);

  // …and the COMMITTED annotation still wears its BPMN bracket: only the ghost is
  // the footprint.
  canvas.clearAppendPreview();
  const note = canvas.appendElement(node(canvas, 'Task_1'), { type: BPMN.TextAnnotation })!;
  expect(canvas.getGraphics(note.id)!.querySelector('path')!.getAttribute('d'))
    .toMatch(/^M\d/);
  expect(canvas.getGraphics(note.id)!.querySelector('path')!.getAttribute('d'))
    .not.toContain('Z');
});

test('a successor keeps its orthogonal route and its filled arrowhead', async () => {
  // The straight, arrowless treatment is the plain association ALONE — the same
  // append path with an end event is untouched (`edge-videos/preview/frame_02`).
  const { canvas } = await load();
  const task = node(canvas, 'Task_1');

  expect(canvas.previewAppend(task, { type: BPMN.EndEvent })).toBeDefined();
  const ghost = canvas.getSvg().querySelector('.sf-append-preview-line')!;
  expect(ghost.getAttribute('marker-end')).toBe('url(#sf-arrow-sequence)');
  expect(ghost.getAttribute('stroke-dasharray')).toBeNull();
  canvas.clearAppendPreview();

  canvas.appendElement(task, { type: BPMN.EndEvent });
  const flow = [...canvas.getScene()!.elementsById.values()]
    .find((el): el is SceneEdge => el.kind === 'edge' && el.type === BPMN.SequenceFlow)!;
  expect(isOrthogonal(flow.waypoints)).toBe(true);
  expect(canvas.getGraphics(flow.id)!.querySelector('.sf-connection-line')!.getAttribute('marker-end'))
    .toBe('url(#sf-arrow-sequence)');
});

test('an association that declares a direction keeps its arrowhead', () => {
  // BPMN says which associations point: `None` (the default, and the annotation
  // leader's) draws a bare line, `One` and `Both` earn the open arrow. Data
  // associations always point, direction or not.
  expect(markerEndFor(BPMN.Association)).toBeNull();
  expect(markerEndFor(BPMN.Association, { associationDirection: 'None' } as any)).toBeNull();
  expect(markerEndFor(BPMN.Association, { associationDirection: 'One' } as any))
    .toBe('url(#sf-arrow-open)');
  expect(markerEndFor(BPMN.Association, { associationDirection: 'Both' } as any))
    .toBe('url(#sf-arrow-open)');
  expect(markerEndFor('bpmn:DataOutputAssociation')).toBe('url(#sf-arrow-open)');
  expect(markerEndFor(BPMN.SequenceFlow)).toBe('url(#sf-arrow-sequence)');
});
