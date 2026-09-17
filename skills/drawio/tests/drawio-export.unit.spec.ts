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

/** The attributes of one element (`tag`, or the mxCell `id` names), XML-decoded. */
function attributesOf(xml: string, tag: string, id?: string): Record<string, string> {
  const open = id ? new RegExp(`<${tag} id="${id}"([^>]*)>`) : new RegExp(`<${tag}([^>]*)>`);
  const match = xml.match(open);
  expect(match, `${tag}${id ? ` ${id}` : ''} is exported`).toBeTruthy();
  const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  return Object.fromEntries([...match![1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));
}

/** The `<mxPoint>`s of one connection cell, in order. */
function bendsOf(xml: string, id: string): [number, number][] {
  const cell = xml.match(new RegExp(`<mxCell id="${id}"[\\s\\S]*?</mxCell>`))?.[0] ?? '';
  return [...cell.matchAll(/<mxPoint x="(-?\d+)" y="(-?\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

test.describe('draw.io export', () => {
  test('exports what the view shows, in an mxfile named after the diagram', () => {
    const pool = shape({ id: 'Pool', type: 'bpmn:Participant' });
    const lane = shape({ id: 'Lane', type: 'bpmn:Lane', parent: pool });
    const task = shape({ id: 'Task', type: 'bpmn:Task', parent: lane });
    const group = shape({ id: 'Group', type: 'bpmn:Group' });
    const collapsed = shape({ id: 'Sub', type: 'bpmn:SubProcess', isExpanded: false });

    // Registry order is deliberately scrambled: paint order must come from the ranking, not arrival order.
    const xml = exportToDrawio(fakeModeler([
      ROOT, task, group, lane, pool, collapsed,
      shape({ id: 'Hidden', type: 'bpmn:Task', parent: collapsed }),
      { id: 'Task_label', kind: 'label', x: 0, y: 0, width: 10, height: 10, parent: ROOT, businessObject: {} },
      flow('F1', 'bpmn:SequenceFlow', task, collapsed),
    ]));

    expect(xml).toMatch(/<mxfile\b/);
    expect(attributesOf(xml, 'diagram').name).toBe('My study');
    // draw.io's two root cells, which every exported cell hangs from.
    expect(xml).toMatch(/<mxCell id="0"\s*\/>/);
    expect(attributesOf(xml, 'mxCell', '1').parent).toBe('0');
    // Frames before what they frame, then the rest, then connections; no label, and nothing folded in a collapsed container.
    expect(cellIds(xml)).toEqual(['Pool', 'Lane', 'Group', 'Sub', 'Task', 'F1']);
    const geometry = xml.match(/<mxCell id="Task"[\s\S]*?<mxGeometry([^>]*)>/)![1];
    expect(Object.fromEntries([...geometry.matchAll(/(\w+)="(\d+)"/g)].map((m) => [m[1], Number(m[2])])))
      .toEqual({ x: 100, y: 200, width: 100, height: 80 });
    // A connection carries its bends, not the endpoints on the shape borders.
    expect(attributesOf(xml, 'mxCell', 'F1')).toMatchObject({ edge: '1', parent: '1', source: 'Task', target: 'Sub' });
    expect(bendsOf(xml, 'F1')).toEqual([[50, 0], [50, 90]]);
    expect(xml).not.toContain('sourcePoint');

    // Drilled into an expanded container, the view shows its contents, and so does the export.
    const open = shape({ id: 'Open', type: 'bpmn:SubProcess' });
    const drilled = exportToDrawio(fakeModeler([
      ROOT,
      open,
      shape({ id: 'Outside', type: 'bpmn:Task' }),
      shape({ id: 'Inside', type: 'bpmn:Task', parent: open }),
    ], open));
    expect(cellIds(drilled)).toEqual(['Inside']);
  });

  test('labels survive as HTML, and markup in a name stays text', () => {
    const xml = exportToDrawio(fakeModeler([
      ROOT,
      shape({ id: 'T1', type: 'bpmn:Task', bo: { name: 'Trial 1\nRound "A" & B' } }),
      shape({ id: 'T2', type: 'bpmn:Task', bo: { name: 'a <b> c' } }),
      shape({ id: 'Note', type: 'bpmn:TextAnnotation', bo: { text: 'A free-form note.' } }),
      shape({ id: 'Grp', type: 'bpmn:Group', bo: { categoryValueRef: { value: 'Enrolment' } } }),
    ]));

    // A cell value is HTML inside an XML attribute: once XML-decoded, a line break is `<br>` and the name's own
    // markup and entities are still escaped, so draw.io renders them as text.
    expect(attributesOf(xml, 'mxCell', 'T1').value).toBe('Trial 1<br>Round &quot;A&quot; &amp; B');
    expect(attributesOf(xml, 'mxCell', 'T2').value).toBe('a &lt;b&gt; c');
    expect(attributesOf(xml, 'mxCell', 'Note').value).toBe('A free-form note.');
    expect(attributesOf(xml, 'mxCell', 'Grp').value).toBe('Enrolment');
  });
});
