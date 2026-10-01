import { expect, test } from '@playwright/test';

import { xmlToStudy } from '@core/document';
import type { Element, StudyModel } from '@core/model/index';
import { getInferredDataNeighbors } from '@modeler/inspector/dataNeighbors';
import { getPropertiesInScope, getStateProperties, isScopeContainer } from '@modeler/inspector/stateProperties';
import { freshMetamodel, studyModel } from './schemas';
import { exampleNames as examples, exampleText, exampleXml } from './utils';

/** A step's data contract and what the canvas draws are two readings of one file; they must agree. */

const DRAWN_DATA = ['bpmn:DataObjectReference', 'bpmn:DataStoreReference'];

const listOf = (element: Element | undefined, key: string): Element[] => (element?.[key] as Element[] | undefined) ?? [];

function isDrawnData(model: StudyModel, id: unknown): boolean {
  const element = typeof id === 'string' ? model.get(id) : undefined;
  return !!element && DRAWN_DATA.includes(model.host(element));
}

function activities(model: StudyModel): Element[] {
  const found: Element[] = [];
  const visit = (container: Element): void => {
    for (const element of listOf(container, 'flowElements')) {
      found.push(element);
      visit(element);
    }
  };
  model.study.roots.forEach(visit);
  return found;
}

/** The ids of what the steps read or write through their data associations. */
function associatedData(model: StudyModel): string[] {
  return activities(model).flatMap((step) => [
    ...listOf(step, 'dataInputAssociations').flatMap((association) => (association.sourceRef as string[] | undefined) ?? []),
    ...listOf(step, 'dataOutputAssociations').map((association) => association.targetRef as string | undefined).filter((id): id is string => !!id),
  ]);
}

function connectsAnything(model: StudyModel): boolean {
  if (associatedData(model).length > 0) return true;
  if (activities(model).some((element) => model.host(element) === 'bpmn:SequenceFlow')) return true;
  return model.study.roots.some((root) => listOf(root, 'messageFlows').length > 0);
}

test('every shipped example routes its data flow through data associations, and names who reads or writes each data element it draws', () => {
  const problems: string[] = [];
  for (const name of examples) {
    const model = studyModel(exampleText(name));
    const artifactAssociations = model.study.roots
      .flatMap((root) => listOf(root, 'artifacts'))
      .filter((artifact) => model.host(artifact) === 'bpmn:Association');

    for (const a of artifactAssociations.filter((a) => isDrawnData(model, a.sourceRef) !== isDrawnData(model, a.targetRef))) {
      problems.push(`${name}: artifact association ${a.id} (${a.sourceRef} -> ${a.targetRef}) stands in for data flow`);
    }

    // A catalogue joins nothing at all, so its data shapes are specimens (see `connectsAnything`).
    if (!connectsAnything(model)) continue;
    const named = new Set([...associatedData(model), ...artifactAssociations.flatMap((a) => [a.sourceRef, a.targetRef])]);
    for (const element of activities(model).filter((element) => isDrawnData(model, element.id))) {
      if (element.id! in model.study.layout && !named.has(element.id)) {
        problems.push(`${name}: ${element.id} (${element.name ?? ''}) is drawn, but no association names it`);
      }
    }
  }

  expect(problems).toEqual([]);
});

test.describe('what the inspector reports for a step', () => {
  test('names the scope a data association reaches into, and stays quiet about a sibling', async () => {
    // A step two sub-processes in reads a data object its process declares.
    const model = studyModel(`id: harness
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Harness:
  type: Process
  name: Evaluation harness
  flowElements:
    Rubric:
      type: DataObjectReference
      name: Scoring rubric
    Round:
      type: SubProcess
      flowElements:
        Item:
          type: SubProcess
          flowElements:
            Score:
              type: ServiceTask
              dataInputAssociations:
                In_Rubric:
                  sourceRef: [Rubric]
                  transformation: rubric
`);

    expect(getInferredDataNeighbors(model, model.get('Score')!, 'inputs')).toEqual([
      expect.objectContaining({
        name: 'Scoring rubric',
        kind: expect.stringMatching(/data object/i),
        outerScope: 'Evaluation harness',
        binding: 'rubric',
      }),
    ]);

    const sklearn = await xmlToStudy(await exampleXml('sklearn_pipeline'), freshMetamodel());
    expect(getInferredDataNeighbors(sklearn, sklearn.get('select_features')!, 'inputs')).toEqual([
      expect.objectContaining({
        name: 'input_dataset',
        outerScope: undefined,
      }),
    ]);
  });

  test('reads a pool\'s properties from the process it references', async () => {
    // In a collaboration the canvas offers the Collaboration and its pools, never the process itself.
    const model = await xmlToStudy(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="C"><bpmn:participant id="Pool_Reachy" name="Reachy Mini" processRef="Reachy_Participant"/></bpmn:collaboration>
  <bpmn:process id="Reachy_Participant"><bpmn:property id="P_screenGaze" name="screenGaze"/><bpmn:startEvent id="S"/></bpmn:process>
</bpmn:definitions>`, freshMetamodel());
    const pool = model.get('Pool_Reachy')!;

    expect(isScopeContainer(model, pool)).toBe(true);
    expect(getStateProperties(model, pool).map((p) => p.name)).toEqual(['screenGaze']);
    expect(getPropertiesInScope(model, pool).map((p) => [p.name, p.ownerId, p.own])).toEqual([['screenGaze', 'Reachy_Participant', true]]);
  });
});
