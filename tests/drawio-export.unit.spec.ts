import { expect, test } from '@playwright/test';

import { exportToDrawio } from '@modeler/export/drawio';

/** The BPMN -> draw.io mapping, over a hand-built element registry. */

const ROOT = { id: 'Study_1', type: 'bpmn:Process', businessObject: { $type: 'bpmn:Process', name: 'My study' } };

type ShapeSpec = {
  id: string;
  type: string;
  bo?: Record<string, unknown>;
  parent?: any;
  collapsed?: boolean;
  di?: Record<string, string>;
};

function shape({ id, type, bo = {}, parent = ROOT, collapsed, di }: ShapeSpec): any {
  return {
    id,
    type,
    x: 100,
    y: 200,
    width: 100,
    height: 80,
    collapsed,
    parent,
    businessObject: { $type: type, ...bo },
    di: di ? { get: (key: string) => di[key] } : undefined,
  };
}

function flow(id: string, type: string, source: any, target: any, bo: Record<string, unknown> = {}): any {
  return {
    id,
    type,
    parent: ROOT,
    source,
    target,
    businessObject: { $type: type, ...bo },
    waypoints: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 90 }, { x: 100, y: 90 }],
  };
}

/**
 * `EditorPort.elements.findRoot`: the topmost ancestor of `element` — the plane it
 * is drawn on. A shape nested in a sub-process still answers ROOT; one parented to
 * another plane's root answers that plane, which is how `exportToDrawio` drops
 * everything the current plane does not depict.
 */
function findRoot(element: any): any {
  let cursor = element;
  const guard = new Set<any>();
  while (cursor?.parent && !guard.has(cursor)) {
    guard.add(cursor);
    cursor = cursor.parent;
  }
  return cursor;
}

function fakeModeler(elements: any[]): any {
  return {
    backend: 'canvas',
    editor: {
      elements: {
        forEach: (fn: any) => elements.forEach(fn),
        root: () => ROOT,
        findRoot,
      },
    },
    destroy() {},
  };
}

function styleOf(xml: string, id: string): string {
  const match = xml.match(new RegExp(`<mxCell id="${id}"[^>]*?style="([^"]*)"`));
  if (!match) throw new Error(`no cell ${id} in\n${xml}`);
  return match[1];
}

function cellIds(xml: string): string[] {
  return [...xml.matchAll(/<mxCell id="([^"]+)"/g)].map((match) => match[1]).slice(2);
}

test.describe('draw.io export', () => {
  test('wraps the diagram in an mxfile named after the diagram', () => {
    const xml = exportToDrawio(fakeModeler([ROOT, shape({ id: 'T1', type: 'bpmn:Task' })]));

    expect(xml).toContain('<mxfile host="studyflow-modeler">');
    expect(xml).toContain('name="My study"');
    expect(xml).toContain('<mxCell id="0" />');
    expect(xml).toContain('<mxCell id="1" parent="0" />');
    expect(cellIds(xml)).toEqual(['T1']);
  });

  test('keeps each element\'s geometry', () => {
    const xml = exportToDrawio(fakeModeler([ROOT, shape({ id: 'T1', type: 'bpmn:Task' })]));

    expect(xml).toContain('<mxGeometry x="100" y="200" width="100" height="80" as="geometry" />');
  });

  test('maps activities onto draw.io\'s task markers', () => {
    const types = ['bpmn:Task', 'bpmn:UserTask', 'bpmn:ServiceTask', 'bpmn:ScriptTask', 'bpmn:SendTask'];
    const xml = exportToDrawio(fakeModeler([
      ROOT,
      ...types.map((type, i) => shape({ id: `T${i}`, type })),
    ]));

    expect(styleOf(xml, 'T0')).toContain('taskMarker=abstract;');
    expect(styleOf(xml, 'T1')).toContain('taskMarker=user;');
    expect(styleOf(xml, 'T2')).toContain('taskMarker=service;');
    expect(styleOf(xml, 'T3')).toContain('taskMarker=script;');
    expect(styleOf(xml, 'T4')).toContain('taskMarker=send;');
    expect(styleOf(xml, 'T1')).toContain('shape=mxgraph.bpmn.task2;');
  });

  test('maps events onto their outline and symbol', () => {
    const xml = exportToDrawio(fakeModeler([
      ROOT,
      shape({ id: 'Start', type: 'bpmn:StartEvent' }),
      shape({ id: 'End', type: 'bpmn:EndEvent' }),
      shape({ id: 'Timer', type: 'bpmn:IntermediateCatchEvent', bo: { eventDefinitions: [{ $type: 'bpmn:TimerEventDefinition' }] } }),
      shape({ id: 'Throw', type: 'bpmn:IntermediateThrowEvent' }),
      shape({ id: 'Bound', type: 'bpmn:BoundaryEvent', bo: { cancelActivity: false } }),
    ]));

    expect(styleOf(xml, 'Start')).toContain('outline=standard;symbol=general;');
    expect(styleOf(xml, 'End')).toContain('outline=end;symbol=general;');
    expect(styleOf(xml, 'Timer')).toContain('outline=catching;symbol=timer;');
    expect(styleOf(xml, 'Throw')).toContain('outline=throwing;symbol=general;');
    expect(styleOf(xml, 'Bound')).toContain('outline=boundNonint;');
  });

  test('maps gateways, including the two draw.io has no gwType for', () => {
    const xml = exportToDrawio(fakeModeler([
      ROOT,
      shape({ id: 'Ex', type: 'bpmn:ExclusiveGateway' }),
      shape({ id: 'Par', type: 'bpmn:ParallelGateway' }),
      shape({ id: 'Inc', type: 'bpmn:InclusiveGateway' }),
      shape({ id: 'Evt', type: 'bpmn:EventBasedGateway' }),
    ]));

    expect(styleOf(xml, 'Ex')).toContain('gwType=exclusive;');
    expect(styleOf(xml, 'Par')).toContain('gwType=parallel;');
    expect(styleOf(xml, 'Inc')).toContain('outline=standard;symbol=general;');
    expect(styleOf(xml, 'Evt')).toContain('outline=standard;symbol=multiple;');
  });

  test('a sub-process is a solid frame; only a transaction sets bpmnShapeType', () => {
    const xml = exportToDrawio(fakeModeler([
      ROOT,
      shape({ id: 'Sub', type: 'bpmn:SubProcess', collapsed: true }),
      shape({ id: 'Open', type: 'bpmn:SubProcess' }),
      shape({ id: 'Tx', type: 'bpmn:Transaction', collapsed: true }),
      shape({ id: 'Loop', type: 'bpmn:SubProcess', collapsed: true, bo: { loopCharacteristics: { $type: 'bpmn:MultiInstanceLoopCharacteristics' } } }),
    ]));

    // draw.io reads bpmnShapeType=subprocess as an *event* sub-process (dashed border), so a plain one omits it.
    expect(styleOf(xml, 'Sub')).not.toContain('bpmnShapeType');
    expect(styleOf(xml, 'Sub')).toContain('isLoopSub=1;');
    expect(styleOf(xml, 'Open')).not.toContain('isLoopSub=1;');
    expect(styleOf(xml, 'Tx')).toContain('bpmnShapeType=transaction;');
    expect(styleOf(xml, 'Loop')).toContain('isLoopMultiParallel=1;');
  });

  test('connections carry their bends, not the endpoints on the shape borders', () => {
    const source = shape({ id: 'A', type: 'bpmn:Task' });
    const target = shape({ id: 'B', type: 'bpmn:Task' });
    const xml = exportToDrawio(fakeModeler([ROOT, source, target, flow('F1', 'bpmn:SequenceFlow', source, target)]));

    expect(xml).toContain('<mxCell id="F1" value="" style="edgeStyle=orthogonalEdgeStyle;');
    expect(xml).toContain('edge="1" parent="1" source="A" target="B"');
    expect(xml).toContain('<mxPoint x="50" y="0" />');
    expect(xml).toContain('<mxPoint x="50" y="90" />');
    expect(xml).not.toContain('<mxPoint x="0" y="0" />');
    expect(xml).not.toContain('sourcePoint');
  });

  test('distinguishes conditional, default, message and association connectors', () => {
    const gateway = shape({ id: 'G', type: 'bpmn:ExclusiveGateway' });
    const target = shape({ id: 'B', type: 'bpmn:Task' });
    const fallback = flow('Default', 'bpmn:SequenceFlow', gateway, target);
    gateway.businessObject.default = fallback.businessObject;

    const xml = exportToDrawio(fakeModeler([
      ROOT, gateway, target, fallback,
      flow('Cond', 'bpmn:SequenceFlow', gateway, target, { conditionExpression: { body: 'x > 1' } }),
      flow('Msg', 'bpmn:MessageFlow', gateway, target),
      flow('Assoc', 'bpmn:Association', gateway, target),
    ]));

    expect(styleOf(xml, 'Default')).toContain('startArrow=dash;');
    expect(styleOf(xml, 'Cond')).toContain('startArrow=diamondThin;');
    expect(styleOf(xml, 'Msg')).toContain('startArrow=oval;');
    expect(styleOf(xml, 'Msg')).toContain('dashed=1;');
    expect(styleOf(xml, 'Assoc')).toContain('endArrow=none;');
  });

  test('a dangling connection pins the end it cannot attach', () => {
    const source = shape({ id: 'A', type: 'bpmn:Task' });
    const xml = exportToDrawio(fakeModeler([ROOT, source, flow('F1', 'bpmn:SequenceFlow', source, undefined)]));

    expect(xml).toContain('source="A"');
    expect(xml).not.toContain('target=');
    expect(xml).toContain('<mxPoint x="100" y="90" as="targetPoint" />');
  });

  test('frames are written before what they frame', () => {
    const pool = shape({ id: 'Pool', type: 'bpmn:Participant' });
    const lane = shape({ id: 'Lane', type: 'bpmn:Lane', parent: pool });
    const task = shape({ id: 'Task', type: 'bpmn:Task', parent: lane });
    const group = shape({ id: 'Group', type: 'bpmn:Group' });

    // Registry order is deliberately scrambled: paint order must come from the ranking, not arrival order.
    const xml = exportToDrawio(fakeModeler([ROOT, task, group, lane, pool]));

    expect(cellIds(xml)).toEqual(['Pool', 'Lane', 'Group', 'Task']);
  });

  test('a choreography task becomes a stack of participant bands', () => {
    const subject = { name: 'Subject' };
    const experimenter = { name: 'Experimenter' };
    const task = shape({
      id: 'Chor',
      type: 'bpmn:ChoreographyTask',
      bo: {
        name: 'Give consent',
        participantRef: [subject, experimenter],
        initiatingParticipantRef: experimenter,
      },
    });

    const xml = exportToDrawio(fakeModeler([ROOT, task]));

    expect(cellIds(xml)).toEqual(['Chor', 'Chor-band-top', 'Chor-body', 'Chor-band-bottom']);
    expect(styleOf(xml, 'Chor')).toContain('childLayout=stackLayout;');
    expect(xml).toContain('<mxCell id="Chor-band-top" value="Subject"');
    expect(xml).toContain('<mxCell id="Chor-body" value="Give consent"');
    expect(xml).toContain('<mxCell id="Chor-band-bottom" value="Experimenter"');
    expect(xml).toContain('parent="Chor"');
    expect(styleOf(xml, 'Chor-band-top')).toContain('fillColor=#ededed;');
    expect(styleOf(xml, 'Chor-band-bottom')).not.toContain('fillColor=#ededed;');
    expect(xml).toContain('<mxGeometry x="0" y="0" width="100" height="20" as="geometry" />');
    expect(xml).toContain('<mxGeometry x="0" y="20" width="100" height="40" as="geometry" />');
  });

  test('carries element colors over to draw.io', () => {
    const xml = exportToDrawio(fakeModeler([
      ROOT,
      shape({ id: 'T1', type: 'bpmn:Task', di: { 'color:background-color': '#ffe0b2', 'color:border-color': '#e65100' } }),
      shape({ id: 'T2', type: 'bpmn:Task', di: { 'bioc:fill': '#bbdefb' } }),
    ]));

    expect(styleOf(xml, 'T1')).toContain('fillColor=#ffe0b2;strokeColor=#e65100;');
    expect(styleOf(xml, 'T2')).toContain('fillColor=#bbdefb;');
  });

  test('labels survive as HTML, and markup in a name stays text', () => {
    const xml = exportToDrawio(fakeModeler([
      ROOT,
      shape({ id: 'T1', type: 'bpmn:Task', bo: { name: 'Trial 1\nRound "A" & B' } }),
      shape({ id: 'T2', type: 'bpmn:Task', bo: { name: 'a <b> c' } }),
      shape({ id: 'Note', type: 'bpmn:TextAnnotation', bo: { text: 'A free-form note.' } }),
      shape({ id: 'Grp', type: 'bpmn:Group', bo: { categoryValueRef: { value: 'Enrolment' } } }),
    ]));

    // A cell value is HTML inside an XML attribute, escaped twice: `&amp;amp;` parses to `&amp;`, renders `&`.
    expect(xml).toContain('value="Trial 1&lt;br&gt;Round &amp;quot;A&amp;quot; &amp;amp; B"');
    expect(xml).toContain('value="a &amp;lt;b&amp;gt; c"');
    expect(xml).toContain('<mxCell id="Note" value="A free-form note."');
    expect(xml).toContain('<mxCell id="Grp" value="Enrolment"');
  });

  test('skips labels and anything on another drilldown plane', () => {
    const otherPlane = { id: 'Sub_plane', type: 'bpmn:SubProcess', businessObject: {} };
    const xml = exportToDrawio(fakeModeler([
      ROOT,
      shape({ id: 'T1', type: 'bpmn:Task' }),
      { id: 'T1_label', type: 'label', x: 0, y: 0, width: 10, height: 10, parent: ROOT, businessObject: {} },
      shape({ id: 'Hidden', type: 'bpmn:Task', parent: otherPlane }),
    ]));

    expect(cellIds(xml)).toEqual(['T1']);
  });
});
