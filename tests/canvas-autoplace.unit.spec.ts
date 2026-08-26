import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { APPEND_DISTANCE, Canvas, appendPosition, setDocument } from '@canvas/index.ts';
import type { SceneNode } from '@canvas/model/scene.ts';

import { loadSchemaModels } from './schemas';

/**
 * Click-append and its placement solver (P6b §3A, `interaction/autoplace.ts`).
 *
 * The contract is the one bpmn-js's `AutoPlace` + `BpmnAutoPlaceUtil` state: a
 * clicked append needs no pointer, so the editor picks the spot — one fixed gap to
 * the right of the source, vertically centred on it — mints the successor there and
 * connects the two, writing BOTH halves (business object + DI) for each, exactly as
 * a dropped shape and a dragged connection would.
 */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const dom = new JSDOM('<!doctype html><html><body></body></html>');
setDocument(dom.window.document as unknown as Document);

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
  const moddle = new BpmnModdle(structuredClone(packages)) as any;
  const { rootElement: definitions } = await moddle.fromXML(PROCESS_XML);
  const canvas = new Canvas();
  canvas.importDefinitions(definitions);
  return { canvas, definitions };
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

/** The live plane's DI children, which is what `bpmn-moddle` re-serializes. */
function planeElements(definitions: any): any[] {
  return definitions.diagrams[0].plane.planeElement ?? [];
}

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
});
