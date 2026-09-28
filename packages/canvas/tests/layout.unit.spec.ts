import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { Study, type Bounds, type Point } from '@canvas/index.ts';

import { freshModdle } from '@tests/schemas';

/** Tidy: the study's `layout` verb lays the whole diagram out afresh, as one edit. */

const open = (yaml: string): Study => Study.fromDefinitions(studyflowToDefinitions(yaml, freshModdle()));
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
});
