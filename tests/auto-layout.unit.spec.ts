import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { studyflowToXml } from '@behaverse/studyflow-core/document';
import { toModdlePackages } from '@behaverse/studyflow-core/notation/schemaFile';
import { ensureDiagramLayout, hasDiagramInterchange } from '../src/modeler/diagram/autoLayout';
import { loadSchemaModels } from './schemas';
import { exampleXml, withoutDiagramInterchange } from './utils';

/** Hand-written `.studyflow` files carry no BPMN DI, which bpmn-js alone aborts the import on. */

const models = loadSchemaModels();
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const layoutlessXml = () => {
  const text = readFileSync(path.join(process.cwd(), 'tests/fixtures/layoutless.studyflow'), 'utf8');
  return studyflowToXml(text, new BpmnModdle(structuredClone(packages)) as any);
};

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

  test('returns a diagram that already carries geometry unchanged', async () => {
    const authored = exampleXml('consort2025.studyflow.png');
    expect(hasDiagramInterchange(authored)).toBe(true);
    expect(await ensureDiagramLayout(authored, schemaModdle())).toBe(authored);
  });

  test('draws the data associations an authored layout left out', async () => {
    // The worst case for a reader: a file that positions its shapes but never draws its associations.
    const complete = exampleXml('cognitive_battery.studyflow.png');
    const stripped = complete.replace(/[ \t]*<bpmndi:BPMNEdge id="DataOutput_[\s\S]*?<\/bpmndi:BPMNEdge>\n/g, '');
    expect(stripped).toMatch(/dataOutputAssociation id="DataOutput_Survey_Data"/);
    expect(stripped).not.toMatch(/BPMNEdge[^>]*bpmnElement="DataOutput_Survey_Data"/);

    const repaired = await ensureDiagramLayout(stripped, schemaModdle());

    expect(repaired).toMatch(/BPMNEdge[^>]*bpmnElement="DataOutput_Survey_Data"/);
    expect(repaired).toMatch(/BPMNEdge[^>]*bpmnElement="DataOutput_WhichOne_Data"/);
    expect(repaired).toMatch(/<di:waypoint/);

    for (const bounds of complete.match(/<dc:Bounds[^>]*\/>/g) ?? []) {
      expect(repaired).toContain(bounds);
    }
  });

  test('draws data associations and places data elements next to their steps', async () => {
    // sklearn_pipeline joins its artifacts with data input/output associations — the data-flow pass's case.
    const xml = withoutDiagramInterchange(exampleXml('sklearn_pipeline.studyflow.png'));
    expect(hasDiagramInterchange(xml)).toBe(false);

    const laidOut = await ensureDiagramLayout(xml, schemaModdle());

    for (const association of [
      'DataOutput_Features', 'DataOutput_Target', 'DataInput_Features_Split',
      'DataInput_Target_Split', 'DataInput_Stratify', 'DataOutput_X_Train',
      'DataOutput_X_Test', 'DataOutput_Y_Train', 'DataOutput_Y_Test', 'DataOutput_Estimator',
      'DataInput_Estimator_CV', 'DataInput_X_Train_CV', 'DataInput_Y_Train_CV',
      'DataOutput_CV_Result', 'DataInput_CV_Result_Report', 'DataOutput_Mean_CV_Accuracy',
      'DataInput_Estimator_Fit', 'DataInput_X_Train_Fit', 'DataInput_Y_Train_Fit',
      'DataInput_X_Test_Predict', 'DataOutput_Predictions', 'DataInput_Y_Test_Score',
      'DataInput_Predictions_Score', 'DataOutput_Test_Metrics',
      'DataInput_Test_Metrics_Report', 'DataInput_Y_Test_Plot', 'DataInput_Predictions_Plot'
    ]) {
      expect(laidOut).not.toMatch(new RegExp(`BPMNEdge[^>]*bpmnElement="${association}"`));
      expect(laidOut).toMatch(new RegExp(`dataInputAssociation|dataOutputAssociation`));
    }

    const { rootElement: definitions } = await (new BpmnModdle() as any).fromXML(laidOut);
    const shapes = new Map<string, any>();
    for (const diagram of definitions.diagrams ?? []) {
      for (const di of diagram.plane?.get('planeElement') ?? []) {
        if (di.$type === 'bpmndi:BPMNShape' && di.bpmnElement?.id) shapes.set(di.bpmnElement.id, di.bounds);
      }
    }
    const dataset = shapes.get('Input_Dataset')!;
    const selectFeatures = shapes.get('Select_Features')!;
    const summarize = shapes.get('Summarize_CV')!;
    expect(dataset.y).toBeGreaterThan(selectFeatures.y + selectFeatures.height); // below the flow band
    expect(dataset.x).toBeGreaterThan(selectFeatures.x); // pulled toward its consumers, off the left column
    const model = shapes.get('Fitted_Model')!;
    expect(model.y).toBeGreaterThan(summarize.y); // likewise for the produced artifact

    // bpmn-auto-layout's own plain-moddle round-trip would silently drop extension child elements.
    expect(laidOut).toContain('implementation="python://sklearn.model_selection.cross_validate"');
    expect(laidOut).toContain('operationType="crossValidate"');
    expect(laidOut).toContain('<studyflow:additionalArguments>');
    expect(laidOut).toContain('precision_macro');
  });
});
