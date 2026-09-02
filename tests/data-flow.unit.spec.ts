import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '@core/notation';
import { toModdlePackages } from '@core/notation/schemaFile';
import { inlineIoSpecification } from '@core/document';
import { getInferredDataNeighbors } from '@modeler/inspector/dataNeighbors';
import { getPropertiesInScope, getStateProperties } from '@modeler/inspector/stateProperties';
import { loadSchemaModels } from './schemas';
import { exampleNames as examples, exampleXml } from './utils';

/** A step's data contract and what the canvas draws are two readings of one file; they must agree. */

const models = loadSchemaModels();
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
setCatalog(buildCatalog(models));

type Model = { definitions: any; planes: Array<Map<string, any>>; edges: Set<string> };

const DRAWN_DATA = ['bpmn:DataObjectReference', 'bpmn:DataStoreReference'];

function isDrawnData(element: any): boolean {
  return DRAWN_DATA.includes(element?.$type);
}

function containerOf(element: any): any {
  let node = element?.$parent;
  while (node && node.$type !== 'bpmn:Process' && node.$type !== 'bpmn:SubProcess') node = node.$parent;
  return node;
}

function activities(definitions: any): any[] {
  const found: any[] = [];
  const visit = (container: any): void => {
    for (const element of container?.flowElements ?? []) {
      found.push(element);
      if (element.flowElements) visit(element);
    }
  };
  for (const root of definitions.rootElements ?? []) visit(root);
  return found;
}

function associationsOf(definitions: any): Array<{ association: any; step: any; dataElement: any }> {
  return activities(definitions).flatMap((step: any) => [
    ...(step.dataInputAssociations ?? []).flatMap((association: any) =>
      (association.sourceRef ?? []).map((dataElement: any) => ({ association, step, dataElement }))),
    ...(step.dataOutputAssociations ?? [])
      .filter((association: any) => association.targetRef)
      .map((association: any) => ({ association, step, dataElement: association.targetRef })),
  ]);
}

function connectsAnything(definitions: any): boolean {
  if (associationsOf(definitions).length > 0) return true;
  if (activities(definitions).some((el: any) => el.$type === 'bpmn:SequenceFlow')) return true;
  return (definitions.rootElements ?? []).some((root: any) => (root.messageFlows ?? []).length > 0);
}

async function read(filename: string): Promise<Model> {
  const moddle = new BpmnModdle(structuredClone(packages)) as any;
  const { rootElement: definitions } = await moddle.fromXML(exampleXml(filename));
  // Shipped payloads carry native ioSpecification; fold to the compact form the inspector reads, as import does.
  inlineIoSpecification(definitions);

  const planes: Array<Map<string, any>> = [];
  const edges = new Set<string>();
  for (const diagram of definitions.diagrams ?? []) {
    const shapes = new Map<string, any>();
    for (const di of diagram.plane?.get('planeElement') ?? []) {
      if (!di.bpmnElement?.id) continue;
      if (di.$type === 'bpmndi:BPMNShape') shapes.set(di.bpmnElement.id, di);
      if (di.$type === 'bpmndi:BPMNEdge') edges.add(di.bpmnElement.id);
    }
    planes.push(shapes);
  }
  return { definitions, planes, edges };
}

test.describe('shipped examples: the figure and the data contract agree', () => {
  for (const filename of examples) {
    test(`${filename} draws every association it can draw`, async () => {
      const { definitions, planes, edges } = await read(filename);

      const undrawn = associationsOf(definitions)
        .filter(({ dataElement }) => isDrawnData(dataElement))
        .filter(({ step, dataElement }) =>
          planes.some((shapes) => shapes.has(step.id) && shapes.has(dataElement.id)))
        .filter(({ association }) => !edges.has(association.id))
        .map(({ association, step, dataElement }) => `${association.id}: ${step.id} ~ ${dataElement.id}`);

      expect(undrawn, 'data associations between two shapes on one plane, with no BPMNEdge').toEqual([]);
    });

    test(`${filename} routes its data flow through data associations`, async () => {
      const { definitions } = await read(filename);

      const artifacts: any[] = (definitions.rootElements ?? []).flatMap((root: any) => root.artifacts ?? []);
      const misassociated = artifacts
        .filter((a: any) => a.$type === 'bpmn:Association')
        .filter((a: any) => isDrawnData(a.sourceRef) !== isDrawnData(a.targetRef))
        .map((a: any) => `${a.id}: ${a.sourceRef?.id} -> ${a.targetRef?.id}`);

      expect(misassociated, 'artifact associations standing in for data flow').toEqual([]);
    });

    test(`${filename} says who reads or writes each data element it draws`, async () => {
      const { definitions, planes } = await read(filename);

      // A catalogue joins nothing at all, so its data shapes are specimens (see `connectsAnything`).
      if (!connectsAnything(definitions)) {
        expect(associationsOf(definitions), `${filename} joins nothing, yet associations data`).toEqual([]);
        return;
      }

      const associated = new Set(associationsOf(definitions).map(({ dataElement }) => dataElement?.id));
      const linked = new Set((definitions.rootElements ?? [])
        .flatMap((root: any) => root.artifacts ?? [])
        .filter((a: any) => a.$type === 'bpmn:Association')
        .flatMap((a: any) => [a.sourceRef?.id, a.targetRef?.id]));

      const orphans = activities(definitions)
        .filter(isDrawnData)
        .filter((element: any) => planes.some((shapes) => shapes.has(element.id)))
        .filter((element: any) => !associated.has(element.id) && !linked.has(element.id))
        .map((element: any) => `${element.id} (${element.name ?? ''})`);

      expect(orphans, 'data elements drawn on the canvas that no association names').toEqual([]);
    });
  }

  test('a data association out of a sub-process is reported with the scope it reaches into', async () => {
    // agent_eval declares artifacts on the process (they outlive the loop) and reads them from nested steps.
    const { definitions, planes } = await read('agent_eval.studyflow.png');

    const crossing = associationsOf(definitions)
      .filter(({ step, dataElement }) =>
        isDrawnData(dataElement) && containerOf(dataElement) !== containerOf(step));

    expect(crossing.length).toBeGreaterThan(0);
    for (const { step, dataElement } of crossing) {
      // Both ends are drawn on the one plane; the tag reports the container the step sits in.
      expect(planes.some((shapes) => shapes.has(step.id) && shapes.has(dataElement.id))).toBe(true);
      expect(containerOf(dataElement).name || containerOf(dataElement).id).toBeTruthy();
    }
  });
});

function elementById(definitions: any, id: string): any {
  return [...activities(definitions), ...(definitions.rootElements ?? [])].find((e: any) => e.id === id);
}

test.describe('what the inspector reports for a step', () => {
  test('names the scope a data association reaches into, and stays quiet about a sibling', async () => {
    const { definitions } = await read('agent_eval.studyflow.png');

    expect(getInferredDataNeighbors(elementById(definitions, 'Score'), 'inputs')).toEqual([
      expect.objectContaining({
        name: 'Scoring rubric',
        kind: 'data object',
        outerScope: 'Agent evaluation harness',
        binding: 'rubric',
      }),
    ]);

    const { definitions: sklearn } = await read('sklearn_pipeline.studyflow.png');
    expect(getInferredDataNeighbors(elementById(sklearn, 'select_features'), 'inputs')).toEqual([
      expect.objectContaining({
        name: 'input_dataset',
        outerScope: undefined,
      }),
    ]);
  });

  test('hides the property bpmn-js invents to hold a data association\'s target', async () => {
    // `__targetRef_placeholder` is bpmn-js's own invented `bpmn:Property`, not an authored one; lablink_demo2 ships one.
    const { definitions } = await read('lablink_demo2.studyflow.png');
    const step = elementById(definitions, 'ReadBIDS');
    expect(step.properties.map((p: any) => p.name)).toContain('__targetRef_placeholder');

    expect(getStateProperties(step)).toEqual([]);
    expect(getPropertiesInScope(step).map((p) => p.name)).not.toContain('__targetRef_placeholder');

    expect(getInferredDataNeighbors(step, 'inputs').map((n) => n.name)).toEqual(['Raw BIDS data']);
  });
});
