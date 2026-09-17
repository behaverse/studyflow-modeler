import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { studyflowToDefinitions, xmlToStudyflow } from '@core/document';
import type { Editor } from '@modeler/editor/port';
import { runUpdateMessage } from '@modeler/inspector/commands';
import { messageStructureOf } from '@modeler/inspector/stateProperties';
import { freshModdle } from './schemas';

/** A message flow's Message field: `messageRef` -> `bpmn:Message` -> `itemRef` -> `bpmn:ItemDefinition.structureRef`. */

const FILE = `id: msg
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Screen: { processRef: S }
    Robot: { processRef: R }
  messageFlows:
    Msg_Trial: { sourceRef: Play, targetRef: Answer }
    Msg_Answer: { sourceRef: Answer, targetRef: Play }
S:
  type: Process
  flowElements:
    Play: { type: Task }
R:
  type: Process
  flowElements:
    Answer: { type: ReceiveTask }
`;

function editorOver(m: any): Editor {
  return {
    model: { createBusinessObject: (type: string, props?: Record<string, unknown>) => m.create(type, props ?? {}) },
    canvas: {
      updateModdleProperties(_el: any, target: any, props: Record<string, any>) {
        for (const [k, v] of Object.entries(props)) target.set(k, v);
      },
    },
  } as unknown as Editor;
}

test('the Message field makes one message per structure, shares it, and drops it with its last flow', async () => {
  const m = freshModdle();
  const definitions = studyflowToDefinitions(FILE, m, () => {});
  const collaboration = definitions.rootElements.find((re: any) => re.$type === 'bpmn:Collaboration');
  const [trial, answer] = collaboration.messageFlows;
  const editor = editorOver(m);
  const roots = (type: string) => definitions.rootElements.filter((re: any) => re.$type === type);

  expect(messageStructureOf(trial)).toBe('');

  runUpdateMessage(editor, { type: 'UpdateMessage', element: trial, structureRef: 'behaverse:Trial' });
  expect(messageStructureOf(trial)).toBe('behaverse:Trial');
  expect(roots('bpmn:Message')).toHaveLength(1);
  expect(roots('bpmn:ItemDefinition').map((re: any) => re.structureRef)).toEqual(['behaverse:Trial']);

  // A second flow with the same structure shares the message; another structure gets one of its own.
  runUpdateMessage(editor, { type: 'UpdateMessage', element: answer, structureRef: 'behaverse:Trial' });
  expect(answer.messageRef).toBe(trial.messageRef);
  runUpdateMessage(editor, { type: 'UpdateMessage', element: answer, structureRef: 'lab:Ping' });
  expect(roots('bpmn:Message')).toHaveLength(2);

  // Clearing drops the message no flow carries any more; its item definition stays (a property may be typed by it).
  runUpdateMessage(editor, { type: 'UpdateMessage', element: answer, structureRef: '' });
  expect(answer.messageRef).toBeUndefined();
  expect(roots('bpmn:Message')).toHaveLength(1);
  expect(roots('bpmn:ItemDefinition')).toHaveLength(2);

  const doc = yaml.load(await xmlToStudyflow((await m.toXML(definitions, { format: true })).xml, freshModdle())) as Record<string, any>;
  expect(doc.C.messageFlows.Msg_Trial.messageRef).toBe('Message_behaverse_Trial');
  expect(doc.Message_behaverse_Trial).toMatchObject({ type: 'Message', itemRef: 'ItemDefinition_behaverse_Trial' });
  expect(doc.ItemDefinition_behaverse_Trial).toMatchObject({ type: 'ItemDefinition', structureRef: 'behaverse:Trial' });
});
