import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, setDocument } from '@canvas/index.ts';
import type { ModdleObject, SceneNode } from '@canvas/model/scene.ts';

import { loadSchemaModels } from './schemas';

/**
 * Dropping the first pool on a `bpmn:Process` root (P6b §3A,
 * `Writeback.promoteRootToCollaboration`).
 *
 * A process cannot contain a participant, so the drop is only legal because it
 * PROMOTES the root: the plane starts depicting a fresh `bpmn:Collaboration`, and the
 * pool depicts the process the plane used to. bpmn-js does the same thing from
 * `CreateParticipantBehavior` + `UpdateCanvasRootBehavior`, and the test that both
 * backends now share is `tests/modeler.palette.spec.ts` "a participant template
 * arrives with its flow".
 *
 * The thing worth guarding here is the SECOND half: everything already drawn ends up
 * inside the pool whose process owns it. Get that wrong and the document still
 * validates — it just re-imports as a pool standing next to its own contents.
 */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const dom = new JSDOM('<!doctype html><html><body></body></html>');
setDocument(dom.window.document as unknown as Document);

/** A blank diagram, as "New" produces one: a process root with a single start event. */
const PROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Study_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Study_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="412" y="240" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** The same, with nothing drawn at all. */
const EMPTY_XML = PROCESS_XML
  .replace('<bpmn:startEvent id="StartEvent_1" />', '')
  .replace(/<bpmndi:BPMNShape[\s\S]*?<\/bpmndi:BPMNShape>/, '');

/** A process root with an expanded sub-process, to prove the exception is root-only. */
const SUBPROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_2" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Study_2" isExecutable="false">
    <bpmn:subProcess id="Sub_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_2">
    <bpmndi:BPMNPlane id="Plane_2" bpmnElement="Study_2">
      <bpmndi:BPMNShape id="Sub_1_di" bpmnElement="Sub_1" isExpanded="true">
        <dc:Bounds x="200" y="100" width="400" height="300" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(xml: string): Promise<{ canvas: Canvas; definitions: any; moddle: any }> {
  const moddle = new BpmnModdle(structuredClone(packages)) as any;
  const { rootElement: definitions } = await moddle.fromXML(xml);
  const canvas = new Canvas();
  canvas.importDefinitions(definitions);
  return { canvas, definitions, moddle };
}

function rootElement(definitions: any, type: string): ModdleObject | undefined {
  return (definitions.rootElements ?? []).find((r: any) => r.$type === type);
}

/**
 * Drop a pool centred at `center`; `undefined` when the rules refuse it. The default
 * is empty space — a drop ONTO a shape is judged against that shape, not the root,
 * and a start event contains nothing.
 */
function dropPool(canvas: Canvas, center = { x: 900, y: 900 }): SceneNode | undefined {
  return canvas.createElement({ type: 'bpmn:Participant' }, center);
}

test.describe('promoting a process root to a collaboration', () => {
  test('the plane changes what it depicts, and the pool depicts what it used to', async () => {
    const { canvas, definitions } = await load(EMPTY_XML);
    const process = rootElement(definitions, 'bpmn:Process')!;

    const pool = dropPool(canvas);
    expect(pool).toBeTruthy();

    // A brand-new collaboration is a root element beside the process, not instead of
    // it — `processRef` is an idref, so the process must still serialize.
    const collaboration = rootElement(definitions, 'bpmn:Collaboration')!;
    expect(collaboration).toBeTruthy();
    expect(definitions.rootElements).toContain(process);
    expect((collaboration as any).participants).toEqual([pool!.businessObject]);

    // No SECOND process was minted for the pool: it points at the original.
    expect((pool!.businessObject as any).processRef).toBe(process);
    expect(definitions.rootElements.filter((r: any) => r.$type === 'bpmn:Process')).toHaveLength(1);

    // And the plane now depicts the collaboration, in the scene and in the DI.
    const plane = canvas.getScene()!.rootPlane;
    expect(plane.businessObject).toBe(collaboration);
    expect(definitions.diagrams[0].plane.bpmnElement).toBe(collaboration);
  });

  test('the pool is sized and placed to enclose what was already drawn', async () => {
    const { canvas } = await load(PROCESS_XML);
    const start = canvas.getScene()!.elementsById.get('StartEvent_1') as SceneNode;

    // Dropped well away from the start event on purpose: on a populated root the drop
    // point says THAT a pool arrives, not where it goes.
    const pool = dropPool(canvas, { x: 900, y: 900 })!;

    expect(pool.x).toBeLessThanOrEqual(start.x);
    expect(pool.y).toBeLessThanOrEqual(start.y);
    expect(pool.x + pool.width).toBeGreaterThanOrEqual(start.x + start.width);
    expect(pool.y + pool.height).toBeGreaterThanOrEqual(start.y + start.height);

    // ...and it adopted it, rather than merely covering it.
    expect(pool.children).toContain(start);
    expect(start.parent).toBe(pool);
    expect(canvas.getScene()!.rootPlane.children).not.toContain(start);
  });

  test('what was in the process stays in the process — the pool just points at it', async () => {
    const { canvas, definitions } = await load(PROCESS_XML);
    const process = rootElement(definitions, 'bpmn:Process')!;

    expect(dropPool(canvas)).toBeTruthy();

    // The one containment that must NOT move: a promoted root re-parents nothing.
    expect(((process as any).flowElements ?? []).map((f: any) => f.id)).toEqual(['StartEvent_1']);
  });

  test('re-importing the promoted document rebuilds the same nesting', async () => {
    const { canvas, definitions, moddle } = await load(PROCESS_XML);
    const pool = dropPool(canvas)!;

    // The real proof that the geometry is right: serialize, re-import into a fresh
    // canvas (which derives nesting from bounds, since BPMN DI has none) and see the
    // start event land back inside the pool.
    const { xml } = await moddle.toXML(definitions, { format: true });
    expect(xml).toContain('<bpmn:collaboration');
    expect(xml).toContain('<bpmn:process');

    const reloaded = await load(xml);
    const restoredPool = reloaded.canvas.getScene()!.elementsById.get(pool.id) as SceneNode;
    const restoredStart = reloaded.canvas.getScene()!.elementsById.get('StartEvent_1') as SceneNode;
    expect(restoredStart.parent).toBe(restoredPool);
  });

  test('a second pool is filed normally — the root is promoted once', async () => {
    const { canvas, definitions } = await load(EMPTY_XML);
    const first = dropPool(canvas, { x: 400, y: 200 })!;
    const second = dropPool(canvas, { x: 400, y: 700 })!;

    expect(definitions.rootElements.filter((r: any) => r.$type === 'bpmn:Collaboration')).toHaveLength(1);
    // The second pool has nothing to inherit, so it gets a process of its own.
    const firstRef = (first.businessObject as any).processRef;
    const secondRef = (second.businessObject as any).processRef;
    expect(secondRef).toBeTruthy();
    expect(secondRef).not.toBe(firstRef);
    expect(definitions.rootElements).toContain(secondRef);
  });

  test('a pool is still refused inside a sub-process — only the ROOT promotes', async () => {
    const { canvas, definitions } = await load(SUBPROCESS_XML);

    // Centred well inside the expanded sub-process.
    expect(dropPool(canvas, { x: 400, y: 250 })).toBeUndefined();
    expect(rootElement(definitions, 'bpmn:Collaboration')).toBeUndefined();
    expect(canvas.getScene()!.rootPlane.businessObject.$type).toBe('bpmn:Process');
  });
});
