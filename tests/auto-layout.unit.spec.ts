import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { Study } from '@canvas/index.ts';
import type { Bounds } from '@canvas/index.ts';
import { studyflowToDefinitions, studyflowToXml } from '@core/document';
import { ensureDiagramLayout, hasDiagramInterchange } from '@modeler/diagram/autoLayout';
import { SPREAD } from '@modeler/diagram/edgeSpread';
import { tidyLayout } from '@modeler/diagram/tidy';
import { freshModdle } from './schemas';
import { exampleNames, exampleXml, withoutDiagramInterchange } from './utils';

/** A hand-written `.studyflow` file carries no BPMN DI, and the canvas never lays out: import draws it first. */

const layoutlessXml = () => {
  const text = readFileSync(path.join(process.cwd(), 'tests/fixtures/layoutless.studyflow'), 'utf8');
  return studyflowToXml(text, freshModdle());
};

test.describe('ensureDiagramLayout', () => {
  test('synthesizes DI for a layout-less diagram, preserving every extension', async () => {
    const xml = await layoutlessXml();
    // Precondition: the converted file has no geometry, this is the failing case.
    expect(hasDiagramInterchange(xml)).toBe(false);

    const laidOut = await ensureDiagramLayout(xml, freshModdle());

    expect(hasDiagramInterchange(laidOut)).toBe(true);
    expect(laidOut).toContain('BPMNPlane');
    expect(laidOut).toMatch(/BPMNShape[^>]*bpmnElement="Enroll"/);
    expect(laidOut).toMatch(/BPMNShape[^>]*bpmnElement="DidNotStart"/); // boundary event laid out too
    expect(laidOut).toMatch(/BPMNEdge[^>]*bpmnElement="Flow_Eligible"/);

    expect(laidOut).toContain('studyflow:study');
    expect(laidOut).toContain('cognitive:questionnaire');
    expect(laidOut).toContain('instrument="screening"');
    expect(laidOut).toContain('attachedToRef="Allocate"');
  });

  test('returns a diagram that already carries geometry unchanged, so every shipped example draws what it can', async () => {
    // Unchanged also means no data association between two shapes on one plane lacks its edge.
    for (const name of exampleNames) {
      const authored = await exampleXml(name);
      const opened = await ensureDiagramLayout(authored, freshModdle());
      expect(opened === authored, `${name} gains geometry on open: a data association it could draw has no edge`).toBe(true);
    }
  });

  test('slides edges that auto-layout stacked on one line apart, and keeps their ends on the outline', async () => {
    // CONSORT fans out at a gateway, fans in on an event, and sends three flows down one corridor.
    const laidOut = await ensureDiagramLayout(withoutDiagramInterchange(await exampleXml('consort2025')), freshModdle());
    const { rootElement: definitions } = await (new BpmnModdle() as any).fromXML(laidOut);
    const edges = new Map<string, { x: number; y: number }[]>();
    for (const di of definitions.diagrams[0].plane.get('planeElement')) {
      if (di.$type === 'bpmndi:BPMNEdge') edges.set(di.bpmnElement.id, di.waypoint.map((p: any) => ({ x: p.x, y: p.y })));
    }

    // No two axis-aligned runs share a line for more than a point.
    const runs = [...edges].flatMap(([id, points]) => points.slice(1).map((b, i) => ({ id, a: points[i], b })));
    for (const p of runs) {
      for (const q of runs) {
        if (p === q || p.id === q.id) continue;
        for (const [axis, along] of [['y', 'x'], ['x', 'y']] as const) {
          if (p.a[axis] !== p.b[axis] || q.a[axis] !== q.b[axis] || p.a[axis] !== q.a[axis]) continue;
          const shared = Math.min(Math.max(p.a[along], p.b[along]), Math.max(q.a[along], q.b[along]))
            - Math.max(Math.min(p.a[along], p.b[along]), Math.min(q.a[along], q.b[along]));
          expect(shared, `${p.id} lies on ${q.id} along ${axis}=${p.a[axis]}`).toBeLessThanOrEqual(0);
        }
      }
    }

    // The two flows leaving the allocation gateway split one spread apart, the one that turns down below the straight
    // one, and both still start on the diamond's outline: a docking slid off the tip is pulled back onto the slope.
    const [a, b] = [edges.get('Flow_Allocate_A')!, edges.get('Flow_Allocate_B')!];
    expect(b[0].y - a[0].y).toBe(SPREAD);
    expect(b[1].y).toBe(b[0].y);
    expect(b[2].y).toBeGreaterThan(b[1].y);
    const gateway = definitions.diagrams[0].plane.get('planeElement')
      .find((di: any) => di.$type === 'bpmndi:BPMNShape' && di.bpmnElement.outgoing?.some((f: any) => f.id === 'Flow_Allocate_A')).bounds;
    const centre = { x: gateway.x + gateway.width / 2, y: gateway.y + gateway.height / 2 };
    for (const docking of [a[0], b[0]]) {
      expect(Math.abs(docking.x - centre.x) / (gateway.width / 2) + Math.abs(docking.y - centre.y) / (gateway.height / 2)).toBeCloseTo(1);
    }
  });

  test('draws the data associations an authored layout left out', async () => {
    // The worst case for a reader: a file that positions its shapes but never draws its associations.
    const complete = await exampleXml('cognitive_battery');
    const stripped = complete.replace(/[ \t]*<bpmndi:BPMNEdge id="DataOutput_[\s\S]*?<\/bpmndi:BPMNEdge>\n/g, '');
    expect(stripped).toMatch(/dataOutputAssociation id="DataOutput_Survey_Data"/);
    expect(stripped).not.toMatch(/BPMNEdge[^>]*bpmnElement="DataOutput_Survey_Data"/);

    const repaired = await ensureDiagramLayout(stripped, freshModdle());

    expect(repaired).toMatch(/BPMNEdge[^>]*bpmnElement="DataOutput_Survey_Data"/);
    expect(repaired).toMatch(/BPMNEdge[^>]*bpmnElement="DataOutput_WhichOne_Data"/);
    expect(repaired).toMatch(/<di:waypoint/);

    for (const bounds of complete.match(/<dc:Bounds[^>]*\/>/g) ?? []) {
      expect(repaired).toContain(bounds);
    }
  });

  test('draws data associations and places data elements next to their steps', async () => {
    // sklearn_pipeline joins its artifacts with data input/output associations, the data-flow pass's case.
    const laidOut = await ensureDiagramLayout(withoutDiagramInterchange(await exampleXml('sklearn_pipeline')), freshModdle());

    // A data object's association is drawn; one into a property has no shape to end on, so it never is.
    expect(laidOut).toMatch(/BPMNEdge[^>]*bpmnElement="DataInput_Input_Features"/);
    expect(laidOut).not.toMatch(/BPMNEdge[^>]*bpmnElement="DataOutput_Features"/);

    const { rootElement: definitions } = await (new BpmnModdle() as any).fromXML(laidOut);
    const shapes = new Map<string, any>();
    for (const diagram of definitions.diagrams ?? []) {
      for (const di of diagram.plane?.get('planeElement') ?? []) {
        if (di.$type === 'bpmndi:BPMNShape' && di.bpmnElement?.id) shapes.set(di.bpmnElement.id, di.bounds);
      }
    }
    const dataset = shapes.get('input_dataset')!;
    const selectFeatures = shapes.get('select_features')!;
    const summarize = shapes.get('summarize_cv')!;
    expect(dataset.y).toBeGreaterThan(selectFeatures.y + selectFeatures.height); // below the flow band
    expect(dataset.x).toBeGreaterThan(selectFeatures.x); // pulled toward its consumers, off the left column
    const model = shapes.get('fitted_model')!;
    expect(model.y).toBeGreaterThan(summarize.y); // likewise for the produced artifact
  });
});

test.describe('tidyLayout', () => {
  const open = (yaml: string): Study => Study.fromDefinitions(studyflowToDefinitions(yaml, freshModdle()));
  const header = (id: string) => `id: ${id}
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
`;

  test('lays a drawn process out afresh, left to right with nothing overlapping, as one undo step', async () => {
    // Drawn anyhow: backwards, and shapes on top of each other.
    const study = open(`${header('Defs_Messy')}Process_M:
  type: Process
  flowElements:
    Start:
      type: StartEvent
      bounds: 500 300 36 36
    Ask:
      type: Task
      name: Ask
      bounds: 100 100 100 80
    Gate:
      type: ExclusiveGateway
      bounds: 120 120 50 50
    Yes:
      type: Task
      name: Yes
      bounds: 50 400 100 80
    No:
      type: Task
      name: No
      bounds: 60 410 100 80
    End:
      type: EndEvent
      bounds: 0 0 36 36
`);
    for (const [from, to] of [['Start', 'Ask'], ['Ask', 'Gate'], ['Gate', 'Yes'], ['Gate', 'No'], ['Yes', 'End'], ['No', 'End']]) {
      expect(study.connect({ from, to }).ok).toBe(true);
    }
    const before = study.get('Start')!.bounds;

    expect(await tidyLayout(study, freshModdle())).toMatchObject({ ok: true });
    const box = (id: string): Bounds => study.get(id)!.bounds!;
    const middle = (id: string): number => box(id).x + box(id).width / 2;
    for (const flow of study.list({ kind: 'edge' })) expect(middle(flow.target!), flow.id).toBeGreaterThan(middle(flow.source!));
    const overlap = (a: Bounds, b: Bounds): boolean =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const shapes = study.list({ kind: 'node' });
    for (const a of shapes) for (const b of shapes) if (a !== b) expect(overlap(a.bounds!, b.bounds!), `${a.id} and ${b.id}`).toBe(false);

    study.undo();
    expect(study.get('Start')!.bounds).toEqual(before);
  });

  test('refuses what the engine cannot draw, and says why', async () => {
    const CASES: [label: string, yaml: string, why: RegExp][] = [
      ['pools', `${header('Defs_Pools')}C:
  type: Collaboration
  participants:
    Pool:
      name: Pool
      processRef: P
      bounds: 40 40 600 250
P:
  type: Process
  flowElements:
    S:
      type: StartEvent
      bounds: 100 100 36 36
`, /pools/],
      ['lanes', `${header('Defs_Lanes')}P:
  type: Process
  laneSets:
    LS:
      lanes:
        L1:
          name: One
          flowNodeRef:
            - S
          bounds: 70 40 770 400
  flowElements:
    S:
      type: StartEvent
      bounds: 200 140 36 36
`, /lanes/],
      ['an open sub-process', `${header('Defs_Open')}P:
  type: Process
  flowElements:
    Sub:
      type: SubProcess
      bounds: 100 100 300 200
      isExpanded: true
      flowElements:
        In:
          type: Task
          bounds: 150 150 100 80
`, /collapse/],
      ['groups', `${header('Defs_Groups')}P:
  type: Process
  flowElements:
    S:
      type: StartEvent
      bounds: 200 140 36 36
  artifacts:
    Phase:
      type: Group
      bounds: 150 100 200 120
`, /groups/],
    ];
    for (const [label, yaml, why] of CASES) expect(await tidyLayout(open(yaml), freshModdle()), label).toMatch(why);
  });
});
