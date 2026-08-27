import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, setDocument } from '@canvas/index.ts';
import type { SceneEdge, SceneNode } from '@canvas/model/scene.ts';

import { loadSchemaModels } from './schemas';

/**
 * Annotating a CONNECTION — the third entry ux-spec §4 records on a selected flow's
 * context pad ("For a connection (3 entries): `append.text-annotation`, `delete`,
 * `set-color`"), and the only append a connection offers.
 *
 * It is worth its own spec because it is the one connection whose SOURCE is another
 * connection. BPMN allows exactly that — `bpmn:Association`'s `sourceRef` is a
 * `bpmn:BaseElement`, not a flow node — but the scene cannot hold the link
 * (`SceneEdge.source` is a node), so three things have to agree without it: what
 * `Writeback.addConnection` writes, what `model/import.ts` reads back, and what
 * `model/remove.ts` takes away with the flow. If any one drifts, `toXML` emits an
 * association pointing at a business object that is not in the document.
 */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const dom = new JSDOM('<!doctype html><html><body></body></html>');
setDocument(dom.window.document as unknown as Document);

function freshModdle(): any {
  return new BpmnModdle(structuredClone(packages)) as any;
}

/** `Start_1 → Task_1`, joined by a plain horizontal flow at y=118. */
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="One"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="300" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="300" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(): Promise<{ canvas: Canvas; definitions: any; moddle: any }> {
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(FIXTURE_XML);
  const canvas = new Canvas();
  canvas.importDefinitions(definitions);
  return { canvas, definitions, moddle };
}

function process(definitions: any): any {
  return definitions.rootElements.find((el: any) => el.id === 'Process_1');
}

function artifacts(definitions: any): any[] {
  return process(definitions).artifacts ?? [];
}

function edge(canvas: Canvas, id: string): SceneEdge {
  return canvas.getScene()!.elementsById.get(id) as SceneEdge;
}

function planeElements(definitions: any): any[] {
  return definitions.diagrams?.[0]?.plane?.planeElement ?? [];
}

/** The annotation the pad's entry appends, as `contextPad/entries.ts` describes it. */
const ANNOTATION = { type: 'bpmn:TextAnnotation' };

// --- the append --------------------------------------------------------------

test('a text annotation appended from a sequence flow hangs off the flow itself', async () => {
  const { canvas, definitions } = await load();
  const flow = edge(canvas, 'Flow_1');

  const annotation = canvas.appendElement(flow, ANNOTATION) as SceneNode;
  expect(annotation).toBeDefined();
  expect(annotation.type).toBe('bpmn:TextAnnotation');

  // Above the MIDDLE of the flow (218, 118), not above either of its ends: the
  // annotation gap is the one `interaction/autoplace.ts` uses for an artifact.
  expect(annotation.x).toBe(218);
  expect(annotation.y + annotation.height).toBe(68);

  // Reached by an association whose source is the FLOW.
  const association = artifacts(definitions).find((el) => el.$type === 'bpmn:Association');
  expect(association).toBeDefined();
  expect(association.sourceRef.id).toBe('Flow_1');
  expect(association.targetRef.id).toBe(annotation.id);
  // The flow's own reference lists are untouched — `outgoing` is typed
  // `bpmn:SequenceFlow` and an association is not one.
  expect(process(definitions).flowElements.find((el: any) => el.id === 'Flow_1').outgoing)
    .toBeUndefined();

  // …and it leaves the flow's midpoint, which is the point that stays put as the
  // two shapes the flow joins move.
  const scene = canvas.getScene()!;
  const drawn = [...scene.elementsById.values()]
    .find((el) => el.kind === 'edge' && el.type === 'bpmn:Association') as SceneEdge;
  expect(drawn.waypoints[0]).toEqual({ x: 218, y: 118 });
  expect(drawn.waypoints).toHaveLength(2);
});

test('the annotation and its association round-trip through bpmn-moddle toXML', async () => {
  const { canvas, definitions, moddle } = await load();
  const flow = edge(canvas, 'Flow_1');
  const annotation = canvas.appendElement(flow, ANNOTATION) as SceneNode;

  // Both halves are in the DI: a shape for the note, an edge for the leader.
  const di = planeElements(definitions);
  expect(di.some((el) => el.$type === 'bpmndi:BPMNShape' && el.bpmnElement?.id === annotation.id))
    .toBe(true);
  expect(di.some((el) => el.$type === 'bpmndi:BPMNEdge' && el.bpmnElement?.$type === 'bpmn:Association'))
    .toBe(true);

  const { xml } = await moddle.toXML(definitions);
  expect(xml).toContain('<bpmn:textAnnotation');
  expect(xml).toContain('sourceRef="Flow_1"');

  // Re-imported, the document says the same thing — and the scene it produces has
  // the same shape the writeback left behind (a drawn association with no scene
  // source, because its source is an edge).
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  const reAssociation = artifacts(reloaded).find((el: any) => el.$type === 'bpmn:Association');
  expect(reAssociation.sourceRef.id).toBe('Flow_1');
  expect(reAssociation.targetRef.id).toBe(annotation.id);

  const second = new Canvas();
  second.importDefinitions(reloaded);
  const imported = [...second.getScene()!.elementsById.values()]
    .find((el) => el.kind === 'edge' && el.type === 'bpmn:Association') as SceneEdge;
  expect(imported.source).toBeUndefined();
  expect(imported.target?.id).toBe(annotation.id);
  expect(imported.waypoints).toEqual([{ x: 218, y: 118 }, ...imported.waypoints.slice(1)]);
});

test('the hover ghost promises exactly what the click commits', async () => {
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_1');

  const ghost = canvas.previewAppend(flow, ANNOTATION);
  expect(ghost).toBeDefined();
  expect(canvas.hasAppendPreview()).toBe(true);
  // A ghost is a picture: nothing is in the document yet.
  expect([...canvas.getScene()!.elementsById.values()]
    .some((el) => el.kind !== 'label' && el.type === 'bpmn:TextAnnotation')).toBe(false);

  canvas.clearAppendPreview();
  const created = canvas.appendElement(flow, ANNOTATION) as SceneNode;
  expect({ x: created.x, y: created.y, width: created.width, height: created.height })
    .toEqual(ghost);
});

test('a flow successor is still refused from a connection — only artifacts hang off one', async () => {
  const { canvas, definitions } = await load();
  const flow = edge(canvas, 'Flow_1');
  const revision = canvas.getScene()!.revision;

  expect(canvas.appendElement(flow, { type: 'bpmn:Task' })).toBeUndefined();
  expect(canvas.previewAppend(flow, { type: 'bpmn:Task' })).toBeUndefined();
  expect(canvas.getScene()!.revision).toBe(revision);
  expect(process(definitions).flowElements.filter((el: any) => el.$type === 'bpmn:Task'))
    .toHaveLength(1);
});

// --- deletion ----------------------------------------------------------------

test('deleting the annotated flow takes its association with it, leaving no dangling ref', async () => {
  const { canvas, definitions, moddle } = await load();
  const flow = edge(canvas, 'Flow_1');
  const annotation = canvas.appendElement(flow, ANNOTATION) as SceneNode;

  const removed = canvas.deleteElements(flow);
  expect(removed.map((el) => el.type).sort()).toEqual(['bpmn:Association', 'bpmn:SequenceFlow']);

  // The note survives its leader — deleting a flow must not delete a comment.
  expect(canvas.getScene()!.elementsById.has(annotation.id)).toBe(true);
  expect(artifacts(definitions).filter((el: any) => el.$type === 'bpmn:Association')).toHaveLength(0);
  expect(planeElements(definitions).some((el) => el.$type === 'bpmndi:BPMNEdge')).toBe(false);

  const { xml } = await moddle.toXML(definitions);
  expect(xml).not.toContain('sourceRef="Flow_1"');
  expect(xml).toContain('<bpmn:textAnnotation');
  // …and it is still a document bpmn-moddle can read back.
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  expect(artifacts(reloaded).map((el: any) => el.$type)).toEqual(['bpmn:TextAnnotation']);
});

test('deleting the annotation alone leaves the flow, and takes only the leader', async () => {
  const { canvas, definitions } = await load();
  const flow = edge(canvas, 'Flow_1');
  const annotation = canvas.appendElement(flow, ANNOTATION) as SceneNode;

  const removed = canvas.deleteElements(annotation);
  expect(removed.map((el) => el.type).sort()).toEqual(['bpmn:Association', 'bpmn:TextAnnotation']);
  expect(canvas.getScene()!.elementsById.has('Flow_1')).toBe(true);
  expect(process(definitions).flowElements.some((el: any) => el.id === 'Flow_1')).toBe(true);
  expect(artifacts(definitions)).toHaveLength(0);
});
