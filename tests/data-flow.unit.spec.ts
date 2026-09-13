import { expect, test } from '@playwright/test';

import { inlineIoSpecification } from '@core/document';
import { getInferredDataNeighbors } from '@modeler/inspector/dataNeighbors';
import { getPropertiesInScope, getStateProperties, isScopeContainer } from '@modeler/inspector/stateProperties';
import { freshModdle } from './schemas';
import { exampleNames as examples, exampleXml } from './utils';

/** A step's data contract and what the canvas draws are two readings of one file; they must agree. */

type Model = { definitions: any; planes: Array<Map<string, any>> };

const DRAWN_DATA = ['bpmn:DataObjectReference', 'bpmn:DataStoreReference'];

function isDrawnData(element: any): boolean {
  return DRAWN_DATA.includes(element?.$type);
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

/** What the steps read or write through their data associations. */
function associatedData(definitions: any): any[] {
  return activities(definitions).flatMap((step: any) => [
    ...(step.dataInputAssociations ?? []).flatMap((association: any) => association.sourceRef ?? []),
    ...(step.dataOutputAssociations ?? []).map((association: any) => association.targetRef).filter(Boolean),
  ]);
}

function connectsAnything(definitions: any): boolean {
  if (associatedData(definitions).length > 0) return true;
  if (activities(definitions).some((el: any) => el.$type === 'bpmn:SequenceFlow')) return true;
  return (definitions.rootElements ?? []).some((root: any) => (root.messageFlows ?? []).length > 0);
}

async function read(name: string): Promise<Model> {
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(await exampleXml(name));
  // Shipped payloads carry native ioSpecification; fold to the compact form the inspector reads, as import does.
  inlineIoSpecification(definitions);

  const planes: Array<Map<string, any>> = [];
  for (const diagram of definitions.diagrams ?? []) {
    const shapes = new Map<string, any>();
    for (const di of diagram.plane?.get('planeElement') ?? []) {
      if (di.$type === 'bpmndi:BPMNShape' && di.bpmnElement?.id) shapes.set(di.bpmnElement.id, di);
    }
    planes.push(shapes);
  }
  return { definitions, planes };
}

test('every shipped example routes its data flow through data associations, and names who reads or writes each data element it draws', async () => {
  const problems: string[] = [];
  for (const name of examples) {
    const { definitions, planes } = await read(name);
    const artifactAssociations: any[] = (definitions.rootElements ?? [])
      .flatMap((root: any) => root.artifacts ?? [])
      .filter((a: any) => a.$type === 'bpmn:Association');

    for (const a of artifactAssociations.filter((a) => isDrawnData(a.sourceRef) !== isDrawnData(a.targetRef))) {
      problems.push(`${name}: artifact association ${a.id} (${a.sourceRef?.id} -> ${a.targetRef?.id}) stands in for data flow`);
    }

    // A catalogue joins nothing at all, so its data shapes are specimens (see `connectsAnything`).
    if (!connectsAnything(definitions)) continue;
    const named = new Set([
      ...associatedData(definitions).map((dataElement) => dataElement.id),
      ...artifactAssociations.flatMap((a) => [a.sourceRef?.id, a.targetRef?.id]),
    ]);
    for (const element of activities(definitions).filter(isDrawnData)) {
      if (planes.some((shapes) => shapes.has(element.id)) && !named.has(element.id)) {
        problems.push(`${name}: ${element.id} (${element.name ?? ''}) is drawn, but no association names it`);
      }
    }
  }

  expect(problems).toEqual([]);
});

function elementById(definitions: any, id: string): any {
  return [...activities(definitions), ...(definitions.rootElements ?? [])].find((e: any) => e.id === id);
}

test.describe('what the inspector reports for a step', () => {
  test('names the scope a data association reaches into, and stays quiet about a sibling', async () => {
    const { definitions } = await read('agent_eval');

    expect(getInferredDataNeighbors(elementById(definitions, 'Score'), 'inputs')).toEqual([
      expect.objectContaining({
        name: 'Scoring rubric',
        kind: 'data object',
        outerScope: 'Agent evaluation harness',
        binding: 'rubric',
      }),
    ]);

    const { definitions: sklearn } = await read('sklearn_pipeline');
    expect(getInferredDataNeighbors(elementById(sklearn, 'select_features'), 'inputs')).toEqual([
      expect.objectContaining({
        name: 'input_dataset',
        outerScope: undefined,
      }),
    ]);
  });

  test('reads a pool\'s properties from the process it references', async () => {
    // In a collaboration the canvas offers the Collaboration and its pools, never the process itself.
    const moddle = freshModdle();
    const { rootElement: definitions } = await moddle.fromXML(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="C"><bpmn:participant id="Pool_Reachy" name="Reachy Mini" processRef="Reachy_Participant"/></bpmn:collaboration>
  <bpmn:process id="Reachy_Participant"><bpmn:property id="P_screenGaze" name="screenGaze"/><bpmn:startEvent id="S"/></bpmn:process>
</bpmn:definitions>`);
    const collaboration = definitions.rootElements.find((root: any) => root.$type === 'bpmn:Collaboration');
    const pool = collaboration.participants.find((p: any) => p.id === 'Pool_Reachy');

    expect(isScopeContainer(pool)).toBe(true);
    expect(getStateProperties(pool).map((p) => p.name)).toEqual(['screenGaze']);
    expect(getPropertiesInScope(pool).map((p) => [p.name, p.ownerId, p.own])).toEqual([['screenGaze', 'Reachy_Participant', true]]);
  });
});
