import { expect, test } from '@playwright/test';

import { Canvas, INK } from '@canvas/index.ts';
import { resolvePlaceholders, studyflowToDefinitions } from '@core/document';
import { CHROME, LINE_HEIGHT } from '@canvas/render/labels.ts';
import { choreographyBandHeight } from '@canvas/render/shapes.ts';

import { diElements, edge, freshModdle, installDocument, loadCanvas, loadYaml, node } from './canvasHarness';
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

    const shapes = diElements(definitions).filter((di) => di.$type === 'bpmndi:BPMNShape');
    const edges = diElements(definitions).filter((di) => di.$type === 'bpmndi:BPMNEdge');

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

  const group = node(canvas, 'Group_BpmnEvents');
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

/** Names too long for the band between the glyph and marker rows, on tasks that draw a bottom marker. */
const MARKED_YAML = `id: Defs_Marked
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_Marked:
  type: Process
  flowElements:
    Implemented:
      type: ServiceTask
      name: Congruency effect (Flanker RT and accuracy)
      implementation: python://stats.congruency
      bounds: 100 100 140 80
    Looped:
      type: Task
      name: Divergence (classifier vs random baseline)
      loopCharacteristics:
        type: StandardLoopCharacteristics
      bounds: 300 100 100 80
`;

test('a wrapped name never runs into the marker row of a task that draws a marker', async () => {
  const { canvas } = loadYaml(MARKED_YAML);
  for (const id of ['Implemented', 'Looped']) {
    const lines = [...canvas.getGraphics(id)!.querySelectorAll('text')];
    expect(lines.length, id).toBeGreaterThan(2);
    const lastBottom = Math.max(...lines.map((t) => Number(t.getAttribute('y')))) + LINE_HEIGHT / 2;
    expect(lastBottom, id).toBeLessThanOrEqual(node(canvas, id).height - CHROME.foot);
  }
});

/**
 * Every type the rules call a data shape must also DRAW as one. `bpmn:DataStore`
 * was in the rules' set (so associations could be drawn to it) but not the
 * renderer's, so it fell through to the unknown-vocabulary rect — and the cropper's
 * data-store branch, which lives under the `'data'` category, was unreachable.
 */
const DATA_YAML = `id: Defs_Data
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Store_1:
  type: DataStore
  name: Vault
  bounds: 100 100 50 50
Process_Data:
  type: Process
  flowElements:
    StoreRef_1:
      type: DataStoreReference
      name: Ref
      dataStoreRef: Store_1
      bounds: 200 100 50 50
    ObjRef_1:
      type: DataObjectReference
      name: Obj
      bounds: 300 100 36 50
`;

test('a bare bpmn:DataStore draws as a cylinder, like a data store REFERENCE', async () => {
  const { canvas } = loadYaml(DATA_YAML);
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
  const task = node(canvas, 'Consent');
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
const KINKED_YAML = `id: Defs_1
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
      bounds: 400 100 36 36
    Flow_1:
      sourceRef: Start_1
      targetRef: Task_1
      waypoint: 136,118 180,140 200,120
    Flow_2:
      sourceRef: Task_1
      targetRef: End_1
      waypoint: 300,120 400,118
`;

test('a routed edge renders as a path whose corners are quarter-arcs', async () => {
  const { canvas } = loadYaml(KINKED_YAML);
  const flow1 = edge(canvas, 'Flow_1');
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
const MESSAGE_YAML = `id: Defs_Msg
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Collab_1:
  type: Collaboration
  participants:
    Pool_A:
      name: A
      processRef: Process_A
      bounds: 100 100 400 150
      isHorizontal: true
    Pool_B:
      name: B
      processRef: Process_B
      bounds: 100 300 400 150
      isHorizontal: true
  messageFlows:
    Msg_1:
      sourceRef: Task_A
      targetRef: Task_B
      waypoint: 250,215 250,335
Process_A:
  type: Process
  flowElements:
    Task_A:
      type: Task
      name: A
      bounds: 200 135 100 80
Process_B:
  type: Process
  flowElements:
    Task_B:
      type: Task
      name: B
      bounds: 200 335 100 80
`;

test('a message flow is dashed AND starts with the open circle BPMN gives it', async () => {
  const { canvas } = loadYaml(MESSAGE_YAML);
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
const STATE_YAML = `id: Defs_State
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_State:
  type: Process
  extensionElements:
    - type: studyflow:Study
  flowElements:
    Task_1:
      type: Task
      name: Screen (n={count}, reached {reached})
      bounds: 100 100 100 80
    Excluded_Pre:
      type: EndEvent
      name: Excluded (n={count})
      bounds: 300 120 36 36
      label: 280 160 80 14
state:
  Excluded_Pre:
    count: 3
  _meta:
    reached:
      Task_1: 2
`;

test('a `labelText` option resolves placeholders in drawn labels; the model keeps the raw name', async () => {
  installDocument();
  const definitions = studyflowToDefinitions(STATE_YAML, freshModdle());
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
  const plain = loadYaml(STATE_YAML);
  const plainLabel = plain.canvas.all().find((el) => el.kind === 'label' && (el as any).owner?.id === 'Excluded_Pre')!.id;
  expect(textsOf(plain.canvas, plainLabel).join(' ')).toBe('Excluded (n={count})');
});

/**
 * A cognitive task in the pool of the participant who takes it: a choreography task
 * typed `cognitive:CognitiveTask`, naming that participant.
 */
const COGNITIVE_YAML = `id: Defs_Cog
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Collab_Cog:
  type: Collaboration
  participants:
    Pool_Seat:
      name: Robot
      processRef: Process_Cog
      bounds: 100 100 500 200
      isHorizontal: true
Process_Cog:
  type: Process
  flowElements:
    Play:
      type: ChoreographyTask
      extensionElements:
        - type: cognitive:CognitiveTask
          instrument: psychopy
      name: N-back
      participantRef:
        - Pool_Seat
      bounds: 200 140 160 120
`;

test('a cognitive task shows its presenter and the pool it names, and renaming the pool redraws it', async () => {
  const { canvas } = loadYaml(COGNITIVE_YAML);
  // The upper band is the type's `meta.presenter` (`{instrument}`), the lower the participant.
  expect(textsOf(canvas, 'Play')).toEqual(expect.arrayContaining(['psychopy', 'Robot']));

  const pool = node(canvas, 'Pool_Seat');
  canvas.updateModdleProperties(pool, pool.businessObject, { name: 'Volunteer' });
  expect(textsOf(canvas, 'Play')).toEqual(expect.arrayContaining(['Volunteer']));
  expect(textsOf(canvas, 'Play')).not.toContain('Robot');
});

// --- sub-processes -------------------------------------------------------------------

/**
 * An expanded sub-process with a flow between its children, and a collapsed one with a
 * child of its own and a data output association to a data object beside it.
 */
const SUBPROCESS_YAML = `id: Defs_Sub
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_Sub:
  type: Process
  flowElements:
    Start:
      type: StartEvent
      bounds: 100 122 36 36
    Expanded:
      type: SubProcess
      name: Expanded
      flowElements:
        First:
          type: Task
          bounds: 230 100 100 80
        Second:
          type: Task
          bounds: 450 100 100 80
        Inner_Flow:
          sourceRef: First
          targetRef: Second
          waypoint: 330,140 450,140
      bounds: 200 40 400 200
      isExpanded: true
    Into_Expanded:
      sourceRef: Start
      targetRef: Expanded
      waypoint: 136,140 200,140
    Collapsed:
      type: SubProcess
      name: Collapsed
      dataOutputAssociations:
        Writes:
          targetRef: Record
          waypoint: 300,340 360,340
      flowElements:
        Hidden:
          type: Task
          bounds: 400 500 100 80
      bounds: 200 300 100 80
      isExpanded: false
    Record:
      type: DataObjectReference
      name: Record
      dataObjectRef: Record_Data
      bounds: 360 315 36 50
    Record_Data:
      type: DataObject
`;

test('an expanded sub-process draws the flows between its children over its frame', async () => {
  // Paint order is the one element layer's. A flow inside a container once sat in a layer
  // under every shape, where the container's opaque frame painted over it.
  const { canvas } = loadYaml(SUBPROCESS_YAML);
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
  const full = loadYaml(SUBPROCESS_YAML);
  expect(full.canvas.getGraphics('Hidden')!.getAttribute('display')).toBe('none');
  expect(full.canvas.getGraphics('Writes')!.getAttribute('display')).toBeNull();
  const main = loadYaml(SUBPROCESS_YAML, { mainCanvasOnly: true });
  expect(main.canvas.get('Writes')).toBeTruthy();
});

test('mainCanvasOnly imports nothing inside a sub-process, collapsed or expanded', async () => {
  const full = loadYaml(SUBPROCESS_YAML);
  const main = loadYaml(SUBPROCESS_YAML, { mainCanvasOnly: true });

  // Both frames stay, neither's contents.
  for (const id of ['Collapsed', 'Expanded']) expect(main.canvas.get(id), id).toBeTruthy();
  for (const id of ['Hidden', 'First', 'Second', 'Inner_Flow']) {
    expect(full.canvas.get(id), id).toBeTruthy();
    expect(main.canvas.get(id), id).toBeUndefined();
  }
  expect(main.canvas.toSVG()).not.toContain('data-element-id="First"');
  // Import only reads: the definitions keep every DI element, so the option can run on a live document.
  expect(diElements(main.definitions)).toHaveLength(diElements(full.definitions).length);
});
