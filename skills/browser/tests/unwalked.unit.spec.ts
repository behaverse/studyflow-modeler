import { expect, test } from '@playwright/test';

import { Studyflow } from '@runner/studyflow';
import { validateUnwalked } from '@runner/unwalked';
import { loadSchemaModels, schemaPackages } from '@tests/schemas';

const packages: Record<string, any> = schemaPackages(loadSchemaModels());

/** What a page cannot carry is refused before the first screen, not walked as another study. */
test('a message flow between pools blocks a browser run; a drawn data edge warns; a loop and a timer are walked', async () => {
  const study = await Studyflow.parse(`id: unwalked
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Subject: { name: Subject, processRef: Study }
    Model: { name: Model }
  messageFlows:
    M_Ask: { sourceRef: Practice, targetRef: Model }
Study:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Practice:
      type: Task
      name: Practice
      loopCharacteristics:
        type: StandardLoopCharacteristics
        loopMaximum: 3
      dataOutputAssociations:
        Out_Score:
          targetRef: Score
    Score:
      type: DataObjectReference
    Timeout:
      type: BoundaryEvent
      name: Too slow
      attachedToRef: Practice
      eventDefinitions:
        Timer:
          type: TimerEventDefinition
          timeDuration: PT5M
    End:
      type: EndEvent
    F1: Start -> Practice
    F2: Practice -> End
    F3: Timeout -> End
`, structuredClone(packages));
  const found = validateUnwalked(study).map((issue) => `${issue.severity ?? 'error'} ${issue.nodeId}`).sort();
  expect(found).toEqual(['error M_Ask', 'warning Practice']);
});
