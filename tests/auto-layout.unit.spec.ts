import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { studyflowToXml } from '../src/core/codec';
import { SCHEMAS } from '../src/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/core/schema';
import { ensureDiagramLayout, hasDiagramInterchange } from '../src/modeler/models/autoLayout';

/**
 * Hand-written `.studyflow` files describe only the flow graph and carry no
 * BPMN DI; bpmn-js aborts such an import with "no diagram to display".
 * `ensureDiagramLayout` closes that gap at the import boundary by synthesizing
 * a layout when — and only when — geometry is missing, without disturbing the
 * semantic tree or any extension.
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');
const models = SCHEMAS.map(({ prefix }) =>
  fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
);
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const layoutlessXml = () => {
  const text = readFileSync(path.join(process.cwd(), 'tests/fixtures/layoutless.studyflow'), 'utf8');
  return studyflowToXml(text, new BpmnModdle(structuredClone(packages)) as any);
};

/** Schema-aware moddle, as the modeler passes to `ensureDiagramLayout`. */
const schemaModdle = () => new BpmnModdle(structuredClone(packages)) as any;

test.describe('ensureDiagramLayout', () => {
  test('detects presence and absence of diagram interchange', () => {
    expect(hasDiagramInterchange('<bpmndi:BPMNDiagram id="d"><bpmndi:BPMNPlane/></bpmndi:BPMNDiagram>')).toBe(true);
    expect(hasDiagramInterchange('<bpmn2:definitions><bpmn2:process/></bpmn2:definitions>')).toBe(false);
  });

  test('synthesizes DI for a layout-less diagram, preserving every extension', async () => {
    const xml = await layoutlessXml();
    // Precondition: the converted file has no geometry — this is the failing case.
    expect(hasDiagramInterchange(xml)).toBe(false);

    const laidOut = await ensureDiagramLayout(xml, schemaModdle());

    // A full DI tree is now present: a diagram, a plane, and a shape per node.
    expect(hasDiagramInterchange(laidOut)).toBe(true);
    expect(laidOut).toContain('BPMNPlane');
    expect(laidOut).toMatch(/BPMNShape[^>]*bpmnElement="Enroll"/);
    expect(laidOut).toMatch(/BPMNShape[^>]*bpmnElement="DidNotStart"/); // boundary event laid out too
    expect(laidOut).toMatch(/BPMNEdge[^>]*bpmnElement="Flow_Eligible"/);

    // Auto-layout only *adds* geometry; the semantic tree and its studyflow /
    // cognitive extensions survive untouched.
    expect(laidOut).toContain('studyflow:study');
    expect(laidOut).toContain('cognitive:questionnaire');
    expect(laidOut).toContain('instrument="screening"');
    expect(laidOut).toContain('attachedToRef="Allocate"');
  });

  test('returns a diagram that already carries geometry unchanged', async () => {
    const authored = await studyflowToXml(
      readFileSync(path.join(process.cwd(), 'src/assets/examples/consort2025.studyflow'), 'utf8'),
      new BpmnModdle(structuredClone(packages)) as any,
    );
    expect(hasDiagramInterchange(authored)).toBe(true);
    // No round-trip through auto-layout: the authored bytes are returned as-is.
    expect(await ensureDiagramLayout(authored, schemaModdle())).toBe(authored);
  });

  test('draws data associations and places data elements next to their steps', async () => {
    // sklearn_pipeline ships layout-less and wires its artifacts with data
    // input/output associations — the case the data-flow pass exists for.
    const xml = await studyflowToXml(
      readFileSync(path.join(process.cwd(), 'src/assets/examples/sklearn_pipeline.studyflow'), 'utf8'),
      new BpmnModdle(structuredClone(packages)) as any,
    );
    expect(hasDiagramInterchange(xml)).toBe(false);

    const laidOut = await ensureDiagramLayout(xml, schemaModdle());

    // Every data association got a DI edge with waypoints, so bpmn-js renders
    // it and the inspector can infer the step's inputs/outputs from it.
    for (const wire of [
      'Wire_Load_Digits', 'Wire_Build_Pipeline', 'Wire_Pipeline_CV', 'Wire_Digits_CV',
      'Wire_CV_Metrics', 'Wire_Pipeline_Fit', 'Wire_Digits_Fit', 'Wire_Fit_Model', 'Wire_Model_Save',
    ]) {
      expect(laidOut).toMatch(new RegExp(`BPMNEdge[^>]*bpmnElement="${wire}"`));
    }

    // The data elements were moved out of the disconnected left column into a
    // band beneath the steps they are wired to.
    const { rootElement: definitions } = await (new BpmnModdle() as any).fromXML(laidOut);
    const shapes = new Map<string, any>();
    for (const diagram of definitions.diagrams ?? []) {
      for (const di of diagram.plane?.get('planeElement') ?? []) {
        if (di.$type === 'bpmndi:BPMNShape' && di.bpmnElement?.id) shapes.set(di.bpmnElement.id, di.bounds);
      }
    }
    const digits = shapes.get('Digits')!;
    const load = shapes.get('Load_Data')!;
    const save = shapes.get('Save_Model')!;
    expect(digits.y).toBeGreaterThan(load.y + load.height); // below the flow band
    expect(digits.x).toBeGreaterThan(load.x); // pulled toward its consumers, off the left column
    const model = shapes.get('Final_Model')!;
    expect(model.y).toBeGreaterThan(save.y); // likewise for the produced artifact

    // The semantic tree is re-read from the original XML with the schema-aware
    // moddle, so extension *child elements* survive too — bpmn-auto-layout's
    // own plain-moddle round-trip would silently drop `<studyflow:with>`
    // (the step arguments) from every laid-out import.
    expect(laidOut).toContain('implementation="python://sklearn.datasets.load_digits"');
    expect(laidOut).toContain('operationType="crossValidate"');
    expect(laidOut).toContain('<studyflow:with>');
    expect(laidOut).toContain('as_frame: true');
  });
});
