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
