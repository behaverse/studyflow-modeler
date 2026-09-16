import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { studyflowToXml } from '@core/document';
import { ensureDiagramLayout, hasDiagramInterchange } from '@modeler/diagram/autoLayout';
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

    // The two flows leaving the allocation gateway split 10px apart, the one that turns down below the straight
    // one, and both still start on the diamond's outline: a docking slid off the tip is pulled back onto the slope.
    const [a, b] = [edges.get('Flow_Allocate_A')!, edges.get('Flow_Allocate_B')!];
    expect(b[0].y - a[0].y).toBe(10);
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
