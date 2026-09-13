import { expect, test } from '@playwright/test';

import { exportToDrawio } from '@skills/drawio/modeler';

/** The BPMN -> draw.io mapping, over a hand-built element registry. */

const ROOT = { id: 'Study_1', type: 'bpmn:Process', businessObject: { $type: 'bpmn:Process', name: 'My study' } };

type ShapeSpec = {
  id: string;
  type: string;
  bo?: Record<string, unknown>;
  parent?: any;
  isExpanded?: boolean;
};

function shape({ id, type, bo = {}, parent = ROOT, isExpanded }: ShapeSpec): any {
  return {
    id,
    type,
    x: 100,
    y: 200,
    width: 100,
    height: 80,
    isExpanded,
    parent,
    businessObject: { $type: type, ...bo },
  };
}

function flow(id: string, type: string, source: any, target: any): any {
  return {
    id,
    type,
    parent: ROOT,
    source,
    target,
    businessObject: { $type: type },
    waypoints: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 90 }, { x: 100, y: 90 }],
  };
}

/** The canvas as the export reads it; `scope` is the container the view is drilled into. */
function fakeModeler(elements: any[], scope?: any): any {
  return {
    canvas: {
      all: () => elements,
      getRoot: () => scope ?? ROOT,
      getScope: () => scope,
    },
  };
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

  test('frames are written before what they frame', () => {
    const pool = shape({ id: 'Pool', type: 'bpmn:Participant' });
    const lane = shape({ id: 'Lane', type: 'bpmn:Lane', parent: pool });
    const task = shape({ id: 'Task', type: 'bpmn:Task', parent: lane });
    const group = shape({ id: 'Group', type: 'bpmn:Group' });

    // Registry order is deliberately scrambled: paint order must come from the ranking, not arrival order.
    const xml = exportToDrawio(fakeModeler([ROOT, task, group, lane, pool]));

    expect(cellIds(xml)).toEqual(['Pool', 'Lane', 'Group', 'Task']);
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

  test('skips labels and anything folded inside a collapsed container', () => {
    const collapsed = shape({ id: 'Sub', type: 'bpmn:SubProcess', isExpanded: false });
    const xml = exportToDrawio(fakeModeler([
      ROOT,
      shape({ id: 'T1', type: 'bpmn:Task' }),
      { id: 'T1_label', kind: 'label', x: 0, y: 0, width: 10, height: 10, parent: ROOT, businessObject: {} },
      collapsed,
      shape({ id: 'Hidden', type: 'bpmn:Task', parent: collapsed }),
    ]));

    expect(cellIds(xml)).toEqual(['T1', 'Sub']);
  });

  test('drilled into an expanded container, exports what the view shows: its contents', () => {
    const sub = shape({ id: 'Sub', type: 'bpmn:SubProcess' });
    const xml = exportToDrawio(fakeModeler([
      ROOT,
      sub,
      shape({ id: 'Outside', type: 'bpmn:Task' }),
      shape({ id: 'Inside', type: 'bpmn:Task', parent: sub }),
    ], sub));

    expect(cellIds(xml)).toEqual(['Inside']);
  });
});
