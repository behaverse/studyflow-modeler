import { expect, test } from '@playwright/test';

import { Canvas, INK } from '@canvas/index.ts';
import { resolvePlaceholders, studyflowToDefinitions } from '@core/document';
import { CHROME, LINE_HEIGHT } from '@canvas/render/labels.ts';
import { choreographyBandHeight, PARTICIPANT_BAND } from '@canvas/render/shapes.ts';

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

/** The point a path's opening `M` names. */
function pathStart(d: string): { x: number; y: number } {
  const m = d.match(/^\s*M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/);
  if (!m) throw new Error(`no move-to in ${d}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

/**
 * Where a path's arcs sit: the midpoint of each `A` command's chord (the point before
 * it and its endpoint). A crossing jump is an arc centred on the crossing.
 */
function arcMidpoints(d: string): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let at = { x: 0, y: 0 };
  for (const m of d.matchAll(/([MLA])\s*((?:-?[\d.]+[\s,]*)+)/g)) {
    const nums = m[2].trim().split(/[\s,]+/).map(Number);
    const end = { x: nums[nums.length - 2], y: nums[nums.length - 1] };
    if (m[1] === 'A') points.push({ x: (at.x + end.x) / 2, y: (at.y + end.y) / 2 });
    at = end;
  }
  return points;
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
      expect(pathStart(line!.getAttribute('d')!), `${name}: edge ${id} starts at its first waypoint`).toEqual({ x: first.x, y: first.y });
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

/** The one of those lines that reads `content`, whatever order they were drawn in. */
function textAt(canvas: Canvas, id: string, content: string): SVGTextElement {
  const found = Array.from(canvas.getGraphics(id)!.querySelectorAll('text')).find((t) => t.textContent === content);
  if (!found) throw new Error(`${id} draws no "${content}" (it draws ${JSON.stringify(textsOf(canvas, id))})`);
  return found;
}

test('a group is captioned from its categoryValue, centred across the frame', async () => {
  const canvas = await render('kitchensink');
  // The caption is NOT the group's `name` (it has none): BPMN keeps it on the
  // referenced `bpmn:CategoryValue`.
  for (const id of ['Group_BpmnEvents', 'Group_BpmnGateways', 'Group_Exec']) {
    const caption = (node(canvas, id).businessObject as any).categoryValueRef?.value as string | undefined;
    expect(caption, `${id} has a category value`).toBeTruthy();
    expect(textsOf(canvas, id), id).toEqual([caption]);
  }

  const group = node(canvas, 'Group_BpmnEvents');
  const text = canvas.getGraphics('Group_BpmnEvents')!.querySelector('text')!;
  // Node-local coordinates: horizontally centred on the frame.
  expect(Number(text.getAttribute('x'))).toBeCloseTo(group.width / 2, 6);
  expect(text.getAttribute('text-anchor')).toBe('middle');
});

test('a text annotation draws its `text`, wrapped — not its `name`', async () => {
  const canvas = await render('kitchensink');
  const lines = textsOf(canvas, 'Bd_Annotation');
  const bo = node(canvas, 'Bd_Annotation').businessObject;
  expect(lines.length).toBeGreaterThan(1);
  // The text, the whole text, and nothing else: a `name` is a placeholder BPMN does
  // not display, and drawing it was the bug.
  expect(lines.join(' ')).toBe(bo.text);
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

/** A horizontal flow at y=120 with two tasks above and below it, for a vertical flow to cross. */
const CROSSING_YAML = `id: Defs_Cross
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    Left:
      type: Task
      bounds: 100 80 100 80
    Right:
      type: Task
      bounds: 400 80 100 80
    Top:
      type: Task
      bounds: 250 -100 100 80
    Bottom:
      type: Task
      bounds: 250 300 100 80
    Flow_Across:
      sourceRef: Left
      targetRef: Right
      waypoint: 200,120 400,120
`;

test('the flatter run jumps over the steeper edge it crosses, on either side of the drawing', async () => {
  const { canvas } = loadYaml(CROSSING_YAML);
  const across = canvas.getGraphics('Flow_Across')!.querySelector('path.sf-connection-line')!;
  const pathOf = (id: string): string => canvas.getGraphics(id)!.querySelector('path.sf-connection-line')!.getAttribute('d')!;
  const jumpsIn = (id: string) => arcMidpoints(pathOf(id));
  expect(jumpsIn('Flow_Across')).toEqual([]);

  // The vertical flow lands after the horizontal one was drawn: the crossing still cuts a
  // semicircle into the horizontal path, centred on x=300, and leaves the vertical one straight.
  const down = canvas.connectElements(node(canvas, 'Top'), node(canvas, 'Bottom'), undefined, [{ x: 300, y: -20 }, { x: 300, y: 300 }])!;
  expect(jumpsIn('Flow_Across')).toEqual([{ x: 300, y: 120 }]);
  expect(jumpsIn(down.id)).toEqual([]);
  expect(across.getAttribute('data-waypoints')).toBe('200,120 400,120');

  // A slant across both: flatter than the vertical, so it jumps that; steeper than the
  // horizontal, so the horizontal jumps it (at x=275, its own arc apart from the first).
  const slant = canvas.connectElements(node(canvas, 'Top'), node(canvas, 'Bottom'), undefined, [{ x: 100, y: -20 }, { x: 500, y: 300 }])!;
  expect(jumpsIn('Flow_Across')).toEqual([{ x: 275, y: 120 }, { x: 300, y: 120 }]);
  expect(jumpsIn(slant.id)).toHaveLength(1);
  expect(jumpsIn(down.id)).toEqual([]);
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

  expect(line.getAttribute('stroke-dasharray')).toMatch(/^\d+[\s,]+\d+$/);
  const markerAt = (end: 'start' | 'end'): Element => {
    const id = line.getAttribute(`marker-${end}`)?.match(/^url\(#([^)]+)\)$/)?.[1];
    const marker = id && canvas.getSvg().querySelector(`marker#${id}`);
    if (!marker) throw new Error(`no marker-${end} defined in the SVG`);
    return marker;
  };
  // An arrowhead at the end, and a marker of its own at the start.
  expect(markerAt('end').querySelector('path, polygon')).not.toBeNull();
  expect(markerAt('start')).not.toBe(markerAt('end'));

  // The marker is a real hollow circle: filled with the ink's fill so the line does not
  // show through its middle, as an attribute so an exported SVG (no stylesheet, no CSS
  // variables) paints it white rather than black.
  const marker = markerAt('start').querySelector('circle')!;
  expect(marker, 'an open circle').not.toBeNull();
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
          platform: psychopy
      name: N-back
      participantRef:
        - Pool_Seat
      bounds: 200 140 160 120
`;

test('a cognitive task shows its presenter and the pool it names, and renaming the pool redraws it', async () => {
  const { canvas } = loadYaml(COGNITIVE_YAML);
  // The upper band is the type's `meta.presenter` (`{platform}`), the lower the participant.
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

/** A resolver that answers every marker key, so markers draw as real SVG. */
const ICONS = { iconResolver: () => ({ content: '<path d="M0 0h24v24H0z"/>', viewBox: '0 0 24 24' }) };

/** A pool of four subjects, its process divided into lanes inside an expanded sub-process — both BPMN's own. */
const DIVIDED_YAML = `id: Defs_Divided
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Pool_Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 4
      processRef: P
      bounds: 40 40 800 400
P:
  type: Process
  flowElements:
    Session:
      type: SubProcess
      name: Session
      laneSets:
        LaneSet_Session:
          lanes:
            Lane_Screen:
              name: Screen
              flowNodeRef:
                - S0
              bounds: 130 100 570 130
            Lane_Model:
              name: Model
              bounds: 130 230 570 130
      flowElements:
        S0:
          type: StartEvent
          bounds: 200 140 36 36
      bounds: 100 100 600 260
`;

test('a sub-process divided into lanes draws them inside its frame, as a pool draws its own', async () => {
  const { canvas } = loadYaml(DIVIDED_YAML);
  const frame = node(canvas, 'Session');
  for (const [id, name] of [['Lane_Screen', 'Screen'], ['Lane_Model', 'Model']]) {
    const lane = node(canvas, id);
    // Drawn, inside the sub-process's own frame, and stacked vertically inside it.
    expect(lane.parent, `${id} sits in the sub-process`).toBe(frame);
    expect(lane.x, id).toBeGreaterThanOrEqual(frame.x);
    expect(lane.x + lane.width, id).toBeLessThanOrEqual(frame.x + frame.width);
    expect(lane.y, id).toBeGreaterThanOrEqual(frame.y);
    expect(lane.y + lane.height, id).toBeLessThanOrEqual(frame.y + frame.height);
    expect(translateOf(canvas.getGraphics(id)!), `${id} sits at its DI bounds`).toEqual({ x: lane.x, y: lane.y });
    // A band with a rotated title on the left, like a pool's lane.
    expect(textsOf(canvas, id), id).toEqual([name]);
    expect(canvas.getGraphics(id)!.querySelector('text')!.getAttribute('transform')).toMatch(/^rotate\(-90/);
  }
  // The lanes stack: the second starts where the first ends.
  expect(node(canvas, 'Lane_Model').y).toBe(node(canvas, 'Lane_Screen').y + node(canvas, 'Lane_Screen').height);
  // A node the lane claims by `flowNodeRef` is a child of it, and so of the sub-process.
  expect(node(canvas, 'S0').parent).toBe(node(canvas, 'Lane_Screen'));

  // A sub-process captions its top strip, not a title band, so its own multi-instance marker has nowhere
  // else to go and stays in the foot row — where its filled bottom lane must still stop above it.
  const mi = loadYaml(DIVIDED_YAML
    .replace('      name: Session\n', '      name: Session\n      loopCharacteristics:\n        type: MultiInstanceLoopCharacteristics\n        isSequential: false\n')
    .replace('              name: Model\n', '              name: Model\n              fill: "#e8eef5"\n'), ICONS).canvas;
  const marker = mi.getGraphics('Session')!.querySelector('[data-icon-key="parallel"]')!;
  expect(Number(marker.getAttribute('x')) + Number(marker.getAttribute('width')) / 2).toBeCloseTo(node(mi, 'Session').width / 2, 6);
  const bottom = node(mi, 'Lane_Model');
  expect(Number(mi.getGraphics('Lane_Model')!.querySelector('rect')!.getAttribute('height')))
    .toBeLessThan(bottom.height);
});

const MARKED_POOL_YAML = `id: cohort
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Pool_Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 4
      processRef: P
      bounds: 40 40 800 400
P:
  type: Process
  laneSets:
    LaneSet_P:
      lanes:
        Lane_Screen:
          name: Screen
          fill: "#e8eef5"
          flowNodeRef:
            - S0
          bounds: 70 40 770 400
  flowElements:
    S0:
      type: StartEvent
      bounds: 200 140 36 36
`;

/** The same pool without its lane, so a pool that carries multiplicity alone draws the same marker. */
const BARE_POOL_YAML = MARKED_POOL_YAML.replace(/  laneSets:[\s\S]*?  flowElements:/, '  flowElements:');

test('a pool of several participant instances marks them at the foot of its title band, not under its lanes', async () => {
  // BPMN's participant multiplicity: N instances of the pool's process, marked as a parallel multi-instance
  // activity is. At the pool's bottom centre that marker sits immediately under the bottom lane and reads as
  // that lane's — and a filled lane, painted after the pool it divides, covered it outright. The title band
  // is the pool's own and no lane reaches into it, so the marker goes at its foot, upright, under the name.
  const { canvas } = loadYaml(MARKED_POOL_YAML, ICONS);
  const pool = node(canvas, 'Pool_Subjects');
  const lane = node(canvas, 'Lane_Screen');
  const marker = canvas.getGraphics('Pool_Subjects')!.querySelector('[data-icon-key="parallel"]')!;
  const band = canvas.getGraphics('Lane_Screen')!.querySelector('rect')!;
  const markerY = Number(marker.getAttribute('y'));
  // Centred across the title band, at its foot, inside the pool, with the count under the bars.
  expect(Number(marker.getAttribute('x')) + Number(marker.getAttribute('width')) / 2).toBeCloseTo(PARTICIPANT_BAND / 2, 6);
  expect(markerY + Number(marker.getAttribute('height'))).toBeLessThan(pool.height);
  expect(markerY).toBeGreaterThan(pool.height - 45);
  const count = textAt(canvas, 'Pool_Subjects', '×4');
  expect(Number(count.getAttribute('x'))).toBeCloseTo(PARTICIPANT_BAND / 2, 6);
  expect(Number(count.getAttribute('y')), 'the maximum reads below the bars').toBeGreaterThan(markerY + Number(marker.getAttribute('height')));
  expect(Number(count.getAttribute('y'))).toBeLessThan(pool.height);
  expect(count.getAttribute('fill')).toBe(INK.text);
  // The lane is filled and drawn after the pool, yet it starts right of the band and fills its own full height.
  expect(band.getAttribute('fill')).toBe('#e8eef5');
  expect(lane.x).toBeGreaterThanOrEqual(pool.x + PARTICIPANT_BAND);
  expect(lane.y + lane.height).toBe(pool.y + pool.height);
  expect(Number(band.getAttribute('height'))).toBe(lane.height);
  // The rotated name is centred in what is left of the band, above the marker.
  expect(Number(textAt(canvas, 'Pool_Subjects', 'Subjects').getAttribute('y'))).toBeLessThan(markerY);
  // A pool without a multiplicity draws neither marker nor count; nor does a lane, which carries none of its own.
  const plain = loadYaml(MARKED_POOL_YAML.replace(/      participantMultiplicity:\n        maximum: 4\n/, ''), ICONS).canvas;
  expect(plain.getGraphics('Pool_Subjects')!.querySelector('[data-icon-key="parallel"]')).toBeNull();
  expect(textsOf(plain, 'Pool_Subjects')).toEqual(['Subjects']);
  expect(canvas.getGraphics('Lane_Screen')!.querySelector('[data-icon-key="parallel"]')).toBeNull();
});

test('a pool with multiplicity and no lanes marks it the same way, and a short band truncates the name instead', async () => {
  const bare = loadYaml(BARE_POOL_YAML, ICONS).canvas;
  expect(bare.get('Lane_Screen'), 'no lanes at all').toBeUndefined();
  const marker = bare.getGraphics('Pool_Subjects')!.querySelector('[data-icon-key="parallel"]')!;
  expect(Number(marker.getAttribute('x')) + Number(marker.getAttribute('width')) / 2).toBeCloseTo(PARTICIPANT_BAND / 2, 6);
  // The bars sit a count's row higher than the band's foot, and the count fills that row.
  expect(Number(marker.getAttribute('y'))).toBe(node(bare, 'Pool_Subjects').height - 22 - LINE_HEIGHT);
  expect(textsOf(bare, 'Pool_Subjects')).toContain('×4');
  // Too short for both: the marker and its count keep their place and the name takes what the band has left.
  const short = loadYaml(BARE_POOL_YAML
    .replace('bounds: 40 40 800 400', 'bounds: 40 40 800 90')
    .replace('name: Subjects', 'name: Subjects randomised to the cautious arm'), ICONS).canvas;
  expect(Number(short.getGraphics('Pool_Subjects')!.querySelector('[data-icon-key="parallel"]')!.getAttribute('y'))).toBe(90 - 22 - LINE_HEIGHT);
  const texts = textsOf(short, 'Pool_Subjects');
  expect(texts).toContain('×4');
  expect(texts.find((t) => t !== '×4')).toMatch(/…$/);
});
