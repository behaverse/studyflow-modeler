import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { Study, type Bounds, type ElementRecord, type Point } from '@canvas/index.ts';

import { freshMetamodel, studyModel } from '@tests/schemas';
import { exampleXml, withoutDiagramInterchange } from '@tests/utils';

/**
 * Tidy: the study's `layout` verb lays the whole diagram out afresh, as one edit; and a document read with no
 * drawing is drawn and laid out the same way as it opens, as is what a sub-process drawn closed holds when the
 * document draws none of it.
 */

const open = (yaml: string): Study => Study.of(studyModel(yaml));
const box = (study: Study, id: string): Bounds => study.get(id)!.bounds!;
const middle = (study: Study, id: string): Point => {
  const b = box(study, id);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const bottom = (b: Bounds): number => b.y + b.height;
const holds = (outer: Bounds, inner: Bounds): boolean => inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
/** Every shape's box, to tell whether a layout moved any. */
const boxes = (study: Study): string => JSON.stringify(study.list({ kind: 'node' }).map((r) => [r.id, r.bounds]));

const PROCESS = `id: Defs_Flow
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    Start:
      type: StartEvent
      bounds: 400 300 36 36
    Gate:
      type: ExclusiveGateway
      bounds: 100 400 50 50
    Work:
      type: Task
      bounds: 250 50 100 80
    Done:
      type: EndEvent
      bounds: 50 50 36 36
    Out:
      type: EndEvent
      bounds: 600 600 36 36
    F1:
      sourceRef: Start
      targetRef: Gate
      waypoint: 418,336 125,400
    F2:
      sourceRef: Gate
      targetRef: Work
      waypoint: 150,425 250,90
    F3:
      sourceRef: Work
      targetRef: Done
      waypoint: 250,90 86,68
    F4:
      sourceRef: Gate
      targetRef: Out
      waypoint: 125,450 600,618
`;

test('a flow runs left to right in layers: a chain on one line, the end one branch runs into under its split; one undo step, and a second layout moves nothing', () => {
  const study = open(PROCESS);
  const drawn = boxes(study);
  expect(study.layout()).toMatchObject({ ok: true });

  const [start, gate, work, done] = ['Start', 'Gate', 'Work', 'Done'].map((id) => middle(study, id));
  expect([start.x < gate.x, gate.x < work.x, work.x < done.x]).toEqual([true, true, true]);
  expect([gate.y, work.y, done.y]).toEqual([start.y, start.y, start.y]);
  expect(middle(study, 'Out').x).toBe(gate.x);
  expect(box(study, 'Out').y).toBeGreaterThan(bottom(box(study, 'Gate')));

  const laid = boxes(study);
  study.layout();
  expect(boxes(study)).toBe(laid);
  study.undo();
  expect(boxes(study)).toBe(drawn);
});

test('a flow drawn down the page is laid out down the page', () => {
  const study = open(`id: Defs_Down
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    Start:
      type: StartEvent
      bounds: 100 100 36 36
    Step:
      type: Task
      bounds: 80 300 100 80
    End:
      type: EndEvent
      bounds: 150 500 36 36
    F1:
      sourceRef: Start
      targetRef: Step
      waypoint: 118,136 118,300
    F2:
      sourceRef: Step
      targetRef: End
      waypoint: 130,380 168,500
`);
  study.layout();
  const [start, step, end] = ['Start', 'Step', 'End'].map((id) => middle(study, id));
  expect([step.x, end.x]).toEqual([start.x, start.x]);
  expect([start.y < step.y, step.y < end.y]).toEqual([true, true]);
});

test('lanes are bands of rows, stacked as wide as the widest in their pool; a flow into another lane may run straight down, one within a lane moves right', () => {
  const study = open(`id: Defs_Lanes
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Collab:
  type: Collaboration
  participants:
    Pool:
      processRef: P
      bounds: 0 0 700 300
P:
  type: Process
  laneSets:
    Set:
      lanes:
        Top:
          flowNodeRef:
            - A
            - C
          bounds: 30 0 670 150
        Bottom:
          flowNodeRef:
            - B
          bounds: 30 150 670 150
  flowElements:
    A:
      type: Task
      bounds: 100 40 100 80
    B:
      type: Task
      bounds: 400 190 100 80
    C:
      type: Task
      bounds: 250 40 100 80
    F1:
      sourceRef: A
      targetRef: B
      waypoint: 150,120 450,190
    F2:
      sourceRef: B
      targetRef: C
      waypoint: 450,190 300,120
`);
  study.layout();
  const [pool, top, under] = ['Pool', 'Top', 'Bottom'].map((id) => box(study, id));
  expect([holds(top, box(study, 'A')), holds(top, box(study, 'C')), holds(under, box(study, 'B'))]).toEqual([true, true, true]);
  expect(under).toMatchObject({ x: top.x, y: bottom(top), width: top.width });
  expect([holds(pool, top), holds(pool, under)]).toEqual([true, true]);
  expect(middle(study, 'B').x).toBe(middle(study, 'A').x);
  expect(box(study, 'C').x).toBeGreaterThan(box(study, 'A').x + box(study, 'A').width);
});

test('lanes that are the phases of one flow, each handing on only to later ones, each start at the left edge', () => {
  const study = open(`id: Defs_Phases
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Collab:
  type: Collaboration
  participants:
    Pool:
      processRef: P
      bounds: 0 0 900 450
P:
  type: Process
  laneSets:
    Set:
      lanes:
        Enrol:
          flowNodeRef:
            - S
            - A
          bounds: 30 0 870 150
        Allocate:
          flowNodeRef:
            - B
          bounds: 30 150 870 150
        Follow:
          flowNodeRef:
            - C
            - E
          bounds: 30 300 870 150
  flowElements:
    S:
      type: StartEvent
      bounds: 100 57 36 36
    A:
      type: Task
      bounds: 200 35 100 80
    B:
      type: Task
      bounds: 400 185 100 80
    C:
      type: Task
      bounds: 600 335 100 80
    E:
      type: EndEvent
      bounds: 800 357 36 36
    F1:
      sourceRef: S
      targetRef: A
      waypoint: 136,75 200,75
    F2:
      sourceRef: A
      targetRef: B
      waypoint: 300,75 450,185
    F3:
      sourceRef: B
      targetRef: C
      waypoint: 500,225 650,335
    F4:
      sourceRef: C
      targetRef: E
      waypoint: 700,375 800,375
`);
  study.layout();
  expect(middle(study, 'C').x).toBe(middle(study, 'B').x);
  expect(box(study, 'B').x).toBeLessThan(box(study, 'A').x);
  expect(box(study, 'E').x).toBeGreaterThan(box(study, 'C').x + box(study, 'C').width);
});

test('pools stack, as wide as the widest, and share their layers: what a message reaches stands under what sends it, a start just before its step', () => {
  const study = open(`id: Defs_Pools
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Collab:
  type: Collaboration
  participants:
    Sender:
      processRef: P1
      bounds: 0 0 600 150
    Receiver:
      processRef: P2
      bounds: 0 300 400 150
  messageFlows:
    M:
      sourceRef: Send
      targetRef: Take
      waypoint: 300,115 150,335
P1:
  type: Process
  flowElements:
    Go:
      type: StartEvent
      bounds: 60 57 36 36
    Prepare:
      type: Task
      bounds: 120 35 100 80
    Send:
      type: Task
      bounds: 250 35 100 80
    F1:
      sourceRef: Go
      targetRef: Prepare
      waypoint: 96,75 120,75
    F2:
      sourceRef: Prepare
      targetRef: Send
      waypoint: 220,75 250,75
P2:
  type: Process
  flowElements:
    Wait:
      type: StartEvent
      bounds: 60 357 36 36
    Take:
      type: Task
      bounds: 100 335 100 80
    F3:
      sourceRef: Wait
      targetRef: Take
      waypoint: 96,375 100,375
`);
  study.layout();
  const [sender, receiver] = ['Sender', 'Receiver'].map((id) => box(study, id));
  expect(receiver).toMatchObject({ x: sender.x, width: sender.width });
  expect(receiver.y).toBeGreaterThan(bottom(sender));
  expect(middle(study, 'Take').x).toBe(middle(study, 'Send').x);
  expect(middle(study, 'Wait').x).toBe(middle(study, 'Prepare').x);
});

test('a shape much wider than most spans the layers it covers: what another pool does meanwhile stands under it', () => {
  const study = open(`id: Defs_Wide
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Collab:
  type: Collaboration
  participants:
    Screen:
      processRef: P1
      bounds: 0 0 1400 150
    Robot:
      processRef: P2
      bounds: 0 200 1400 150
  messageFlows:
    M:
      sourceRef: Game
      targetRef: One
      waypoint: 400,115 300,235
P1:
  type: Process
  flowElements:
    Load:
      type: StartEvent
      bounds: 40 57 36 36
    Game:
      type: Task
      bounds: 100 35 600 80
    F1:
      sourceRef: Load
      targetRef: Game
      waypoint: 76,75 100,75
P2:
  type: Process
  flowElements:
    Seated:
      type: StartEvent
      bounds: 40 257 36 36
    One:
      type: Task
      bounds: 100 235 100 80
    Two:
      type: Task
      bounds: 250 235 100 80
    Three:
      type: Task
      bounds: 400 235 100 80
    F2:
      sourceRef: Seated
      targetRef: One
      waypoint: 76,275 100,275
    F3:
      sourceRef: One
      targetRef: Two
      waypoint: 200,275 250,275
    F4:
      sourceRef: Two
      targetRef: Three
      waypoint: 350,275 400,275
`);
  study.layout();
  const game = box(study, 'Game');
  for (const id of ['One', 'Two', 'Three']) expect(middle(study, id).x, id).toBeLessThan(game.x + game.width);
});

test('a loop the drawing shows keeps its head in front, whatever reaches its body first', () => {
  // A message reaches the loop's body before its head is searched from: the drawing tells which flow goes back.
  const study = open(`id: Defs_Loop
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Collab:
  type: Collaboration
  participants:
    Screen:
      processRef: P1
      bounds: 0 0 700 150
    Robot:
      processRef: P2
      bounds: 0 200 700 200
  messageFlows:
    M:
      sourceRef: Serve
      targetRef: Take
      waypoint: 150,115 300,235
P1:
  type: Process
  flowElements:
    Begin:
      type: StartEvent
      bounds: 40 57 36 36
    Serve:
      type: Task
      bounds: 100 35 100 80
    F0:
      sourceRef: Begin
      targetRef: Serve
      waypoint: 76,75 100,75
P2:
  type: Process
  flowElements:
    Go:
      type: StartEvent
      bounds: 40 257 36 36
    Again:
      type: ExclusiveGateway
      bounds: 130 250 50 50
    Take:
      type: Task
      bounds: 250 235 100 80
    Answer:
      type: Task
      bounds: 400 235 100 80
    Stop:
      type: EndEvent
      bounds: 600 257 36 36
    F1:
      sourceRef: Go
      targetRef: Again
      waypoint: 76,275 130,275
    F2:
      sourceRef: Again
      targetRef: Take
      waypoint: 180,275 250,275
    F3:
      sourceRef: Take
      targetRef: Answer
      waypoint: 350,275 400,275
    F4:
      sourceRef: Answer
      targetRef: Again
      waypoint: 450,315 450,360 155,360 155,300
    F5:
      sourceRef: Again
      targetRef: Stop
      waypoint: 155,250 155,220 618,220 618,257
`);
  study.layout();
  expect(middle(study, 'Again').x).toBeLessThan(middle(study, 'Take').x);
});

test('what goes with a shape comes along: a boundary event keeps its place, and its caption keeps its room', () => {
  const study = open(`id: Defs_Boundary
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    Host:
      type: Task
      bounds: 100 100 100 80
    Timer:
      type: BoundaryEvent
      name: taking too long to answer
      attachedToRef: Host
      eventDefinitions:
        T_1:
          type: TimerEventDefinition
      bounds: 132 162 36 36
    Next:
      type: Task
      bounds: 300 100 100 80
    Late:
      type: EndEvent
      bounds: 150 220 36 36
    F1:
      sourceRef: Host
      targetRef: Next
      waypoint: 200,140 300,140
    F2:
      sourceRef: Timer
      targetRef: Late
      waypoint: 150,198 168,220
`);
  study.layout();
  const host = box(study, 'Host');
  expect(box(study, 'Timer')).toMatchObject({ x: host.x + 32, y: host.y + 62 });
  expect(box(study, 'Late').y).toBeGreaterThanOrEqual(bottom(study.get('Timer_label')!.bounds!));
});

test('a group is drawn round the shapes it held, an open sub-process round what it holds, and a data shape stands under its step', () => {
  const study = open(`id: Defs_Held
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    Start:
      type: StartEvent
      bounds: 60 400 36 36
    Sub:
      type: SubProcess
      bounds: 150 300 400 300
      isExpanded: true
      flowElements:
        Inner:
          type: Task
          bounds: 400 450 100 80
    Read:
      type: Task
      bounds: 700 400 100 80
      dataInputAssociations:
        In_1:
          sourceRef:
            - Data
          waypoint: 318,70 750,400
    Data:
      type: DataObjectReference
      bounds: 300 20 36 50
    F1:
      sourceRef: Start
      targetRef: Sub
      waypoint: 96,418 150,418
    F2:
      sourceRef: Sub
      targetRef: Read
      waypoint: 550,440 700,440
  artifacts:
    Around:
      type: Group
      bounds: 40 280 530 340
`);
  study.layout();
  const [start, sub, around] = ['Start', 'Sub', 'Around'].map((id) => box(study, id));
  expect(holds(sub, box(study, 'Inner'))).toBe(true);
  expect([holds(around, start), holds(around, sub), holds(around, box(study, 'Read'))]).toEqual([true, true, false]);
  expect(middle(study, 'Data').x).toBe(middle(study, 'Read').x);
  expect(box(study, 'Data').y).toBeGreaterThan(bottom(box(study, 'Read')));
});

test('what no flow joins keeps its arrangement, or stands in rows when it has none; a group takes the shapes its category names', () => {
  const study = open(`id: Defs_Kept
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    One:
      type: Task
      categoryValueRef:
        - Phase_1
      bounds: 100 100 100 80
    Two:
      type: Task
      categoryValueRef:
        - Phase_1
      bounds: 100 100 100 80
    Three:
      type: Task
      bounds: 100 100 100 80
  artifacts:
    Note:
      type: TextAnnotation
      text: piled on the rest
      bounds: 100 100 100 30
    Around:
      type: Group
      categoryValueRef: Phase_1
      bounds: 0 0 0 0
Phase:
  type: Category
  categoryValue:
    Phase_1:
      value: Phase one
`);
  study.layout();
  const piled = ['One', 'Two', 'Three', 'Note'].map((id) => box(study, id));
  for (const [i, a] of piled.entries()) for (const b of piled.slice(i + 1)) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  const around = box(study, 'Around');
  expect([holds(around, box(study, 'One')), holds(around, box(study, 'Two')), holds(around, box(study, 'Three'))]).toEqual([true, true, false]);

  // Captions reaching over a neighbour are an arrangement still: the shapes keep it.
  const named = open(`id: Defs_Named
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    A:
      type: StartEvent
      name: a rather long caption for a start
      bounds: 100 100 36 36
    B:
      type: StartEvent
      name: another long caption beside it
      bounds: 150 100 36 36
`);
  named.layout();
  expect([box(named, 'B').x - box(named, 'A').x, box(named, 'B').y - box(named, 'A').y]).toEqual([50, 0]);
});

test('flows the router would lay on one line are slid apart', async () => {
  // CONSORT fans out at gateways and sends a boundary event's flow from each step to one shared end.
  const study = await Study.open(await exampleXml('consort2025'), { metamodel: freshMetamodel() });
  study.layout();
  const runs = study.list({ kind: 'edge' }).flatMap((flow: ElementRecord) => flow.waypoints!.slice(1).map((b, i) => ({ flow, a: flow.waypoints![i], b })));
  for (const [i, p] of runs.entries()) {
    for (const q of runs.slice(i + 1)) {
      if (p.flow === q.flow || p.flow.plane !== q.flow.plane) continue;
      for (const [axis, along] of [['y', 'x'], ['x', 'y']] as const) {
        if (p.a[axis] !== p.b[axis] || q.a[axis] !== q.b[axis] || p.a[axis] !== q.a[axis]) continue;
        const shared = Math.min(Math.max(p.a[along], p.b[along]), Math.max(q.a[along], q.b[along]))
          - Math.max(Math.min(p.a[along], p.b[along]), Math.min(q.a[along], q.b[along]));
        expect(shared, `${p.flow.id} lies on ${q.flow.id} along ${axis}=${p.a[axis]}`).toBeLessThanOrEqual(0);
      }
    }
  }
});

test('a document with no drawing is drawn as it opens: laid out, what it holds kept, and it reopens as it was drawn', async () => {
  const text = readFileSync(path.join(process.cwd(), 'tests/fixtures/layoutless.studyflow'), 'utf8');
  const study = await Study.open(text, { metamodel: freshMetamodel() });

  expect(study.get('DidNotStart')).toMatchObject({ kind: 'node', attachedTo: 'Allocate' });
  expect(study.get('Flow_Eligible')).toMatchObject({ kind: 'edge', source: 'Eligibility_Gateway', target: 'Allocate' });
  const [enroll, screening, gateway, allocate] = ['Enroll', 'Screening', 'Eligibility_Gateway', 'Allocate'].map((id) => middle(study, id));
  expect([enroll.x < screening.x, screening.x < gateway.x, gateway.x < allocate.x]).toEqual([true, true, true]);
  expect(box(study, 'Aborted').y, 'what the boundary event leads to stands below its activity').toBeGreaterThan(bottom(box(study, 'Allocate')));

  const xml = await study.toXml();
  for (const kept of ['studyflow:study', 'cognitive:questionnaire', 'instrument="screening"', 'attachedToRef="Allocate"']) expect(xml).toContain(kept);
  expect(boxes(await Study.open(xml, { metamodel: freshMetamodel() }))).toBe(boxes(study));
});

test('a flow whose ends are drawn is drawn as the document opens, in the look the file gives it, and a data association into a property never is', async () => {
  // A file that places its shapes and leaves its data associations out: what it drew stays as drawn.
  const complete = await exampleXml('cognitive_battery');
  const stripped = complete.replace(/[ \t]*<bpmndi:BPMNEdge id="DataOutput_[\s\S]*?<\/bpmndi:BPMNEdge>\n/g, '');
  expect(stripped).not.toMatch(/BPMNEdge[^>]*bpmnElement="DataOutput_Survey_Data"/);
  const study = await Study.open(stripped, { metamodel: freshMetamodel() });
  expect(study.get('DataOutput_Survey_Data')).toMatchObject({ kind: 'edge', source: 'Survey', target: 'Dataset_Battery' });
  expect(boxes(study)).toBe(boxes(await Study.open(complete, { metamodel: freshMetamodel() })));

  // sklearn's pipeline writes its features into a property, which no shape draws.
  const drafted = await Study.open(withoutDiagramInterchange(await exampleXml('sklearn_pipeline')), { metamodel: freshMetamodel() });
  const drawn = drafted.list({ kind: 'edge' }).map((flow) => flow.id);
  expect(drawn).toContain('DataInput_Input_Features');
  expect(drawn).not.toContain('DataOutput_Features');

  // A sequence flow the file gives only its look is routed in that look.
  const looked = await Study.open(`id: D
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    A: { type: Task, bounds: 100 100 100 80 }
    B: { type: Task, bounds: 300 100 100 80 }
    F: A -> B
layout:
  F:
    stroke: "#5c8a55"
`, { metamodel: freshMetamodel() });
  expect(looked.get('F')).toMatchObject({ kind: 'edge', source: 'A', target: 'B' });
  expect(looked.toYaml()).toContain('  F:\n    waypoint: 200,140 300,140\n    stroke: "#5c8a55"\n');
});

test('what a sub-process drawn closed holds is drawn as the document opens when the file draws none of it: laid out on its plane, the rest as drawn', () => {
  const study = open(`id: D
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    Start: { type: StartEvent, bounds: 100 122 36 36 }
    Analysis:
      type: SubProcess
      name: Analysis
      bounds: 200 100 100 80
      isExpanded: false
      flowElements:
        A_Start: { type: StartEvent }
        Read:
          type: ServiceTask
          name: Read the trials
          dataOutputAssociations:
            Out_Table:
              targetRef: Table
        Table: { type: DataObjectReference, name: Trials, dataObjectRef: Table_Data }
        Table_Data: { type: DataObject }
        Enough: { type: ExclusiveGateway, name: Enough subjects? }
        Test:
          type: SubProcess
          name: Test
          flowElements:
            T_Start: { type: StartEvent }
            T_Run: { type: ServiceTask, name: Run the test }
            TF_1: T_Start -> T_Run
        Not_Testable: { type: EndEvent, name: Not testable }
        AF_1: A_Start -> Read
        AF_2: Read -> Enough
        AF_3: Enough -> Test
        AF_4: Enough -> Not_Testable
    End: { type: EndEvent, bounds: 360 122 36 36 }
    F_1:
      sourceRef: Start
      targetRef: Analysis
      waypoint: 136,140 200,140
    F_2:
      sourceRef: Analysis
      targetRef: End
      waypoint: 300,140 360,140
layout:
  Read:
    fill: "#dcebd6"
`);
  expect([box(study, 'Start'), box(study, 'Analysis'), study.get('F_2')!.waypoints]).toEqual([
    { x: 100, y: 122, width: 36, height: 36 }, { x: 200, y: 100, width: 100, height: 80 }, [{ x: 300, y: 140 }, { x: 360, y: 140 }],
  ]);

  const inside = ['A_Start', 'Read', 'Table', 'Enough', 'Test', 'Not_Testable', 'AF_1', 'Out_Table'];
  expect(inside.map((id) => study.get(id)?.plane)).toEqual(inside.map(() => 'Analysis'));
  expect(['T_Start', 'T_Run', 'TF_1'].map((id) => study.get(id)?.plane), 'a sub-process inside is drawn closed, over its own plane').toEqual(['Test', 'Test', 'Test']);
  const [start, read, enough, test] = ['A_Start', 'Read', 'Enough', 'Test'].map((id) => middle(study, id));
  expect([start.x < read.x, read.x < enough.x, enough.x < test.x]).toEqual([true, true, true]);
  const shapes = inside.slice(0, 6).map((id) => box(study, id));
  for (const [i, a] of shapes.entries()) for (const b of shapes.slice(i + 1)) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  expect(study.get('Read')!.fill, 'the look the file gives a shape it does not place is kept').toBe('#dcebd6');
  const where = (drawn: Study): Record<string, Bounds | undefined> => Object.fromEntries(drawn.list({ kind: 'node' }).map((r) => [r.id, r.bounds]));
  expect(where(open(study.toYaml())), 'the drawing is the study\'s from the start').toEqual(where(study));

  study.expand({ id: 'Analysis' });
  for (const id of inside.slice(0, 6)) expect(holds(box(study, 'Analysis'), box(study, id))).toBe(true);
});
