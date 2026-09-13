import { expect, test } from '@playwright/test';

import { Canvas, INK, type SceneEdge } from '@canvas/index.ts';
import { resolvePlaceholders } from '@core/document';
import { choreographyBandHeight } from '@canvas/render/shapes.ts';

import { freshModdle, installDocument, loadCanvas } from './canvasHarness';
import { exampleNames, exampleXml } from '@tests/utils';

/**
 * The drawing, read back out of the SVG. Every shipped example imports one to one:
 * one `<g class="sf-shape">` per `BPMNShape`, translated to its `dc:Bounds`, and one
 * connection path per `BPMNEdge` through its `di:waypoint`. The tests after that pin
 * what a type draws that its DI does not say.
 */

// A single jsdom document backs every render; the canvas is presentation-agnostic
// and only needs a DOM to mint SVG nodes into.
installDocument();

/** Every DI shape and edge across every diagram/plane, in document order. */
function diItems(definitions: any): { shapes: any[]; edges: any[] } {
  const shapes: any[] = [];
  const edges: any[] = [];
  for (const diagram of definitions.diagrams ?? []) {
    const plane = diagram.plane;
    if (!plane) continue;
    for (const pe of plane.planeElement ?? []) {
      if (pe.$type === 'bpmndi:BPMNShape') shapes.push(pe);
      else if (pe.$type === 'bpmndi:BPMNEdge') edges.push(pe);
    }
  }
  return { shapes, edges };
}

/** Parse `translate(x, y)` off a group; a group at the origin carries no transform. */
function translateOf(g: Element | undefined): { x: number; y: number } {
  const t = g?.getAttribute('transform') ?? '';
  const m = t.match(/translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
}

for (const name of exampleNames) {
  test(`${name}: renders to SVG mirroring its DI`, async () => {
    const moddle = freshModdle();
    const { rootElement: definitions } = await moddle.fromXML(await exampleXml(name));

    const { shapes, edges } = diItems(definitions);

    // (a) A full render + serialize does not throw.
    const warnings: string[] = [];
    const canvas = new Canvas({ onWarning: (w: string) => warnings.push(w) });
    canvas.importDefinitions(definitions);
    const svg = canvas.toSVG();
    expect(svg, `${name}: produces an SVG string`).toContain('<svg');
    expect(svg.length, `${name}: SVG is non-empty`).toBeGreaterThan(0);

    const root = canvas.getSvg();

    // (b) One shape group per BPMNShape, translated to its dc:Bounds origin.
    const shapeGroups = root.querySelectorAll('g.sf-shape');
    expect(shapeGroups.length, `${name}: one <g.sf-shape> per BPMNShape`).toBe(
      shapes.length,
    );
    for (const shape of shapes) {
      const id = shape.bpmnElement?.id as string;
      const g = canvas.getGraphics(id);
      expect(g, `${name}: shape ${id} has a rendered group`).toBeTruthy();
      expect(g!.getAttribute('data-element-type')).toBe(shape.bpmnElement.$type);
      expect(translateOf(g), `${name}: shape ${id} sits at its DI bounds`).toEqual({
        x: shape.bounds.x,
        y: shape.bounds.y,
      });
    }

    // (c) One line per BPMNEdge, through its di:waypoint list. The path rounds its
    // corners, so the waypoints are compared as `data-waypoints` keeps them.
    const lines = root.querySelectorAll('path.sf-connection-line');
    expect(lines.length, `${name}: one connection <path> per BPMNEdge`).toBe(
      edges.length,
    );
    for (const di of edges) {
      const id = di.bpmnElement?.id as string;
      const g = canvas.getGraphics(id);
      expect(g, `${name}: edge ${id} has a rendered group`).toBeTruthy();
      const line = g!.querySelector('path.sf-connection-line');
      expect(line, `${name}: edge ${id} draws a connection path`).toBeTruthy();
      const expected = (di.waypoint ?? [])
        .map((wp: any) => `${wp.x},${wp.y}`)
        .join(' ');
      expect(line!.getAttribute('data-waypoints')).toBe(expected);
      // The drawn geometry still STARTS at the first waypoint, whatever the
      // corners in between do (arcs are cut out of a corner, never added around it).
      const first = (di.waypoint ?? [])[0];
      const at = (value: number): number => Math.round(value * 1000) / 1000;
      expect(line!.getAttribute('d')).toMatch(
        new RegExp(`^M ${at(first.x)} ${at(first.y)}\\b`),
      );
    }
  });
}

// --- artifact captions -------------------------------------------------------

/** Render one example and hand back its canvas. */
async function render(name: string): Promise<Canvas> {
  return (await loadCanvas(await exampleXml(name))).canvas;
}

/** The `<text>` lines the renderer drew inside an element's `<g>`. */
function textsOf(canvas: Canvas, id: string): string[] {
  const g = canvas.getGraphics(id);
  return g ? Array.from(g.querySelectorAll('text')).map((t) => t.textContent ?? '') : [];
}

test('a group is captioned from its categoryValue, centred across the frame', async () => {
  const canvas = await render('kitchensink');
  // The caption is NOT the group's `name` (it has none): BPMN keeps it on the
  // referenced `bpmn:CategoryValue`.
  expect(textsOf(canvas, 'Group_BpmnEvents')).toEqual(['BPMN · Events']);
  expect(textsOf(canvas, 'Group_BpmnGateways')).toEqual(['BPMN · Gateways']);
  expect(textsOf(canvas, 'Group_Exec')).toEqual(['exec · Execution & scope']);

  const group = canvas.getScene()!.elementsById.get('Group_BpmnEvents') as any;
  const text = canvas.getGraphics('Group_BpmnEvents')!.querySelector('text')!;
  // Node-local coordinates: horizontally centred on the frame.
  expect(Number(text.getAttribute('x'))).toBeCloseTo(group.width / 2, 6);
  expect(text.getAttribute('text-anchor')).toBe('middle');
});

test('a text annotation draws its `text`, wrapped — not its `name`', async () => {
  const canvas = await render('kitchensink');
  const lines = textsOf(canvas, 'Bd_Annotation');
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.join(' ')).toBe('A free-form note. Groups (these labelled bands) are artifacts too.');
  // The name is a placeholder BPMN does not display; drawing it was the bug.
  expect(lines.join(' ')).not.toContain('Text annotation');
  // A note reads left by default, and says so: its `font` may align it otherwise.
  expect(canvas.getGraphics('Bd_Annotation')!.querySelector('text')!.getAttribute('text-anchor')).toBe('start');
});

/**
 * Every type the rules call a data shape must also DRAW as one. `bpmn:DataStore`
 * was in the rules' set (so associations could be drawn to it) but not the
 * renderer's, so it fell through to the unknown-vocabulary rect — and the cropper's
 * data-store branch, which lives under the `'data'` category, was unreachable.
 */
const DATA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_Data" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:dataStore id="Store_1" name="Vault" />
  <bpmn:process id="Process_Data" isExecutable="false">
    <bpmn:dataStoreReference id="StoreRef_1" name="Ref" dataStoreRef="Store_1" />
    <bpmn:dataObjectReference id="ObjRef_1" name="Obj" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_Data">
    <bpmndi:BPMNPlane id="Plane_Data" bpmnElement="Process_Data">
      <bpmndi:BPMNShape id="Store_1_di" bpmnElement="Store_1">
        <dc:Bounds x="100" y="100" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="StoreRef_1_di" bpmnElement="StoreRef_1">
        <dc:Bounds x="200" y="100" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="ObjRef_1_di" bpmnElement="ObjRef_1">
        <dc:Bounds x="300" y="100" width="36" height="50" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('a bare bpmn:DataStore draws as a cylinder, like a data store REFERENCE', async () => {
  const { canvas } = await loadCanvas(DATA_XML);
  const pathOf = (id: string): string => canvas.getGraphics(id)!.querySelector('path')!.getAttribute('d') ?? '';

  // A cylinder: the body path opens with the lid's elliptical arc.
  expect(pathOf('Store_1')).toContain('A');
  expect(pathOf('Store_1')).toBe(pathOf('StoreRef_1'));
  // …and it is NOT the unknown-vocabulary fallback, which is a rounded <rect>.
  expect(canvas.getGraphics('Store_1')!.querySelector('rect')).toBeNull();

  // A data OBJECT still draws as the dog-eared page (no arcs at all).
  expect(pathOf('ObjRef_1')).not.toContain('A');
});

test('a choreography task draws its name in the MIDDLE band, and shades the band that does not initiate', async () => {
  const canvas = await render('choreography_demo');
  const task = canvas.getScene()!.elementsById.get('Consent') as any;
  const g = canvas.getGraphics('Consent')!;
  const name = Array.from(g.querySelectorAll('text')).find((t) => t.textContent === 'Give consent')!;
  // The name is drawn inside a nested group translated down by one band height, so
  // its EFFECTIVE y is the local y plus that shift.
  const shift = translateOf(name.parentElement as Element).y;
  expect(shift).toBeCloseTo(choreographyBandHeight(task.height), 6);
  // Dead centre of the 20…70 middle band — where `labelBounds` opens the editor —
  // rather than sitting on the top divider, which is where the un-nested draw put it.
  expect(shift + Number(name.getAttribute('y'))).toBeCloseTo(task.height / 2, 6);

  // The initiating participant's band has the task's plain fill; the other is shaded.
  const bandFills = (id: string) => Array.from(canvas.getGraphics(id)!.querySelectorAll('path[data-band]'))
    .map((band) => band.getAttribute('fill'));
  expect(bandFills('Consent'), 'Subject, on top, initiates').toEqual([INK.fill, INK.band]);
  expect(bandFills('Round'), 'Experimenter, below, initiates').toEqual([INK.band, INK.fill]);
});

// --- edges ---------------------------------------------------------------------

/** `Start_1 → Task_1 → End_1`: Flow_1 keeps a hand-drawn kink, Flow_2 is straight. */
const KINKED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="Task"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
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
        <dc:Bounds x="400" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="180" y="140" /><di:waypoint x="200" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="300" y="120" /><di:waypoint x="400" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('a routed edge renders as a path whose corners are quarter-arcs', async () => {
  const { canvas } = await loadCanvas(KINKED_XML);
  const scene = canvas.getScene()!;
  const flow1 = scene.elementsById.get('Flow_1') as SceneEdge;
  expect(flow1.waypoints.length).toBeGreaterThan(2);

  const line = canvas.getGraphics('Flow_1')!.querySelector('path.sf-connection-line')!;
  const d = line.getAttribute('d')!;
  // One arc per corner, cut out of the waypoints rather than added around them —
  // the raw list is still on the element for anything that reads geometry.
  expect(d.startsWith('M ')).toBe(true);
  expect((d.match(/ A /g) ?? []).length).toBe(flow1.waypoints.length - 2);
  expect(line.getAttribute('data-waypoints'))
    .toBe(flow1.waypoints.map((p) => `${p.x},${p.y}`).join(' '));
  // The straight two-point flow has nothing to round.
  const straight = canvas.getGraphics('Flow_2')!.querySelector('path.sf-connection-line')!;
  expect(straight.getAttribute('d')).not.toContain(' A ');
});

/**
 * Two pools and the message flow between them — no shipped example carries one, and
 * BPMN gives it a notation of its own: "a dashed line with an OPEN CIRCLE at the
 * start and an open arrowhead at the end". The circle is what tells it apart from an
 * association, which is dashed too.
 */
const MESSAGE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_Msg" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_A" name="A" processRef="Process_A" />
    <bpmn:participant id="Pool_B" name="B" processRef="Process_B" />
    <bpmn:messageFlow id="Msg_1" sourceRef="Task_A" targetRef="Task_B" />
  </bpmn:collaboration>
  <bpmn:process id="Process_A" isExecutable="false"><bpmn:task id="Task_A" name="A" /></bpmn:process>
  <bpmn:process id="Process_B" isExecutable="false"><bpmn:task id="Task_B" name="B" /></bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_Msg">
    <bpmndi:BPMNPlane id="Plane_Msg" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_A_di" bpmnElement="Pool_A" isHorizontal="true">
        <dc:Bounds x="100" y="100" width="400" height="150" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_A_di" bpmnElement="Task_A">
        <dc:Bounds x="200" y="135" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Pool_B_di" bpmnElement="Pool_B" isHorizontal="true">
        <dc:Bounds x="100" y="300" width="400" height="150" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_B_di" bpmnElement="Task_B">
        <dc:Bounds x="200" y="335" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Msg_1_di" bpmnElement="Msg_1">
        <di:waypoint x="250" y="215" /><di:waypoint x="250" y="335" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('a message flow is dashed AND starts with the open circle BPMN gives it', async () => {
  const { canvas } = await loadCanvas(MESSAGE_XML);
  const line = canvas.getGraphics('Msg_1')!.querySelector('.sf-connection-line')!;

  expect(line.getAttribute('stroke-dasharray')).toBe('8,6');
  expect(line.getAttribute('marker-end')).toBe('url(#sf-arrow-message)');
  expect(line.getAttribute('marker-start')).toBe('url(#sf-marker-message-start)');

  // The marker is a real hollow circle: filled with the ink's fill so the line does not
  // show through its middle, as an attribute so an exported SVG (no stylesheet, no CSS
  // variables) paints it white rather than black.
  const marker = canvas.getSvg().querySelector('#sf-marker-message-start circle')!;
  expect(marker.getAttribute('fill')).toBe(INK.fill);
  expect(marker.getAttribute('stroke')).toBe('context-stroke');
});

/**
 * `{count}` in a name draws its run-state value (docs/reference.qmd, "Run state"): the host
 * passes `labelText`, the renderer routes both the internal caption and the external
 * label element through it, and the model keeps the raw name.
 */
const STATE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1"
    id="Defs_State" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_State" isExecutable="false">
    <bpmn:extensionElements>
      <studyflow:study><studyflow:state>{"Excluded_Pre":{"count":3},"_meta":{"reached":{"Task_1":2}}}</studyflow:state></studyflow:study>
    </bpmn:extensionElements>
    <bpmn:task id="Task_1" name="Screen (n={count}, reached {reached})" />
    <bpmn:endEvent id="Excluded_Pre" name="Excluded (n={count})" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_State">
    <bpmndi:BPMNPlane id="Plane_State" bpmnElement="Process_State">
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="100" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Excluded_Pre_di" bpmnElement="Excluded_Pre">
        <dc:Bounds x="300" y="120" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="280" y="160" width="80" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('a `labelText` option resolves placeholders in drawn labels; the model keeps the raw name', async () => {
  installDocument();
  const { rootElement: definitions } = await freshModdle().fromXML(STATE_XML);
  const canvas = new Canvas({ labelText: (bo, name) => resolvePlaceholders(name, definitions, bo?.id ?? '') });
  canvas.importDefinitions(definitions);

  // The external label of the end event: resolved from its own state entry.
  const labelId = canvas.all().find((el) => el.kind === 'label' && (el as any).owner?.id === 'Excluded_Pre')!.id;
  expect(textsOf(canvas, labelId).join(' ')).toBe('Excluded (n=3)');
  // The task has no `count` in scope: its placeholder stays as written; `{reached}` resolves from `_meta.reached`.
  expect(textsOf(canvas, 'Task_1').join(' ')).toBe('Screen (n={count}, reached 2)');
  // Serialization is untouched.
  expect(definitions.rootElements[0].flowElements[1].name).toBe('Excluded (n={count})');

  // Without the option, nothing is resolved.
  const plain = await loadCanvas(STATE_XML);
  const plainLabel = plain.canvas.all().find((el) => el.kind === 'label' && (el as any).owner?.id === 'Excluded_Pre')!.id;
  expect(textsOf(plain.canvas, plainLabel).join(' ')).toBe('Excluded (n={count})');
});

/**
 * A cognitive task in the pool of the participant who takes it: a choreography task
 * typed `cognitive:CognitiveTask`, naming that participant.
 */
const COGNITIVE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive"
    id="Defs_Cog" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_Cog">
    <bpmn:participant id="Pool_Seat" name="Robot" processRef="Process_Cog" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Cog" isExecutable="false">
    <bpmn:choreographyTask id="Play" name="N-back">
      <bpmn:extensionElements><cognitive:cognitiveTask instrument="psychopy" /></bpmn:extensionElements>
      <bpmn:participantRef>Pool_Seat</bpmn:participantRef>
    </bpmn:choreographyTask>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_Cog">
    <bpmndi:BPMNPlane id="Plane_Cog" bpmnElement="Collab_Cog">
      <bpmndi:BPMNShape id="Pool_Seat_di" bpmnElement="Pool_Seat" isHorizontal="true"><dc:Bounds x="100" y="100" width="500" height="200" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Play_di" bpmnElement="Play"><dc:Bounds x="200" y="140" width="160" height="120" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('a cognitive task shows its presenter and the pool it names, and renaming the pool redraws it', async () => {
  const { canvas } = await loadCanvas(COGNITIVE_XML);
  // The upper band is the type's `meta.presenter` (`{instrument}`), the lower the participant.
  expect(textsOf(canvas, 'Play')).toEqual(expect.arrayContaining(['psychopy', 'Robot']));

  const pool = canvas.getScene()!.elementsById.get('Pool_Seat') as any;
  canvas.updateModdleProperties(pool, pool.businessObject, { name: 'Volunteer' });
  expect(textsOf(canvas, 'Play')).toEqual(expect.arrayContaining(['Volunteer']));
  expect(textsOf(canvas, 'Play')).not.toContain('Robot');
});

// --- sub-processes -------------------------------------------------------------------

/**
 * An expanded sub-process with a flow between its children, and a collapsed one with a
 * child of its own and a data output association to a data object beside it.
 */
const SUBPROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_Sub" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Sub" isExecutable="false">
    <bpmn:startEvent id="Start" />
    <bpmn:subProcess id="Expanded" name="Expanded">
      <bpmn:task id="First" />
      <bpmn:task id="Second" />
      <bpmn:sequenceFlow id="Inner_Flow" sourceRef="First" targetRef="Second" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="Into_Expanded" sourceRef="Start" targetRef="Expanded" />
    <bpmn:subProcess id="Collapsed" name="Collapsed">
      <bpmn:task id="Hidden" />
      <bpmn:dataOutputAssociation id="Writes"><bpmn:targetRef>Record</bpmn:targetRef></bpmn:dataOutputAssociation>
    </bpmn:subProcess>
    <bpmn:dataObjectReference id="Record" name="Record" dataObjectRef="Record_Data" />
    <bpmn:dataObject id="Record_Data" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_Sub">
    <bpmndi:BPMNPlane id="Plane_Sub" bpmnElement="Process_Sub">
      <bpmndi:BPMNShape id="Start_di" bpmnElement="Start"><dc:Bounds x="100" y="122" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Expanded_di" bpmnElement="Expanded" isExpanded="true"><dc:Bounds x="200" y="40" width="400" height="200" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="First_di" bpmnElement="First"><dc:Bounds x="230" y="100" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Second_di" bpmnElement="Second"><dc:Bounds x="450" y="100" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Inner_Flow_di" bpmnElement="Inner_Flow"><di:waypoint x="330" y="140" /><di:waypoint x="450" y="140" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Into_Expanded_di" bpmnElement="Into_Expanded"><di:waypoint x="136" y="140" /><di:waypoint x="200" y="140" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNShape id="Collapsed_di" bpmnElement="Collapsed" isExpanded="false"><dc:Bounds x="200" y="300" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Hidden_di" bpmnElement="Hidden"><dc:Bounds x="400" y="500" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Record_di" bpmnElement="Record"><dc:Bounds x="360" y="315" width="36" height="50" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Writes_di" bpmnElement="Writes"><di:waypoint x="300" y="340" /><di:waypoint x="360" y="340" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('an expanded sub-process draws the flows between its children over its frame', async () => {
  // Paint order is the one element layer's. A flow inside a container once sat in a layer
  // under every shape, where the container's opaque frame painted over it.
  const { canvas } = await loadCanvas(SUBPROCESS_XML);
  const order = Array.from(canvas.getSvg().querySelectorAll('[data-layer="elements"] > g'))
    .map((g) => g.getAttribute('data-element-id'));
  expect(order.indexOf('Inner_Flow')).toBeGreaterThan(order.indexOf('Expanded'));
  expect(canvas.getGraphics('Inner_Flow')!.getAttribute('display')).toBeNull();
  // A root-level flow still passes under the shape it points at.
  expect(order.indexOf('Into_Expanded')).toBeLessThan(order.indexOf('Expanded'));
});

test('a collapsed sub-process hides its contents but draws its own data associations, and mainCanvasOnly keeps them', async () => {
  // A data association's moddle parent is its activity, but it sits beside it: it once
  // counted as the collapsed container's content and went hidden with it.
  const full = await loadCanvas(SUBPROCESS_XML);
  expect(full.canvas.getGraphics('Hidden')!.getAttribute('display')).toBe('none');
  expect(full.canvas.getGraphics('Writes')!.getAttribute('display')).toBeNull();
  const main = await loadCanvas(SUBPROCESS_XML, { mainCanvasOnly: true });
  expect(main.canvas.get('Writes')).toBeTruthy();
});

/** Every DI shape and edge the definitions carry, across their planes. */
const diCount = (definitions: any): number =>
  (definitions.diagrams ?? []).reduce((n: number, diagram: any) => n + (diagram.plane?.planeElement?.length ?? 0), 0);

test('mainCanvasOnly imports nothing inside a sub-process, collapsed or expanded', async () => {
  const full = await loadCanvas(SUBPROCESS_XML);
  const main = await loadCanvas(SUBPROCESS_XML, { mainCanvasOnly: true });

  // Both frames stay, neither's contents.
  for (const id of ['Collapsed', 'Expanded']) expect(main.canvas.get(id), id).toBeTruthy();
  for (const id of ['Hidden', 'First', 'Second', 'Inner_Flow']) {
    expect(full.canvas.get(id), id).toBeTruthy();
    expect(main.canvas.get(id), id).toBeUndefined();
  }
  expect(main.canvas.toSVG()).not.toContain('data-element-id="First"');
  // Import only reads: the definitions keep every DI element, so the option can run on a live document.
  expect(diCount(main.definitions)).toBe(diCount(full.definitions));
});
