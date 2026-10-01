import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { Study } from '@canvas/index.ts';
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

test('the Message field makes one message per structure, shares it, and drops it with its last flow', async () => {
  const study = await Study.open(FILE, { moddle: freshModdle() });
  const editor = { study } as unknown as Editor;
  const flow = (id: string) => study.element(id)!;
  const roots = (type: string) => study.model.study.roots.filter((root) => root.type === type);
  const carry = (id: string, structureRef: string) => runUpdateMessage(editor, { type: 'UpdateMessage', element: flow(id), structureRef });

  expect(messageStructureOf(study.model, flow('Msg_Trial'))).toBe('');

  carry('Msg_Trial', 'behaverse:Trial');
  expect(messageStructureOf(study.model, flow('Msg_Trial'))).toBe('behaverse:Trial');
  expect(roots('bpmn:Message')).toHaveLength(1);
  expect(roots('bpmn:ItemDefinition').map((root) => root.structureRef)).toEqual(['behaverse:Trial']);

  // A second flow with the same structure shares the message; another structure gets one of its own.
  carry('Msg_Answer', 'behaverse:Trial');
  expect(flow('Msg_Answer').messageRef).toBe(flow('Msg_Trial').messageRef);
  carry('Msg_Answer', 'lab:Ping');
  expect(roots('bpmn:Message')).toHaveLength(2);

  // Clearing drops the message no flow carries any more; its item definition stays (a property may be typed by it).
  carry('Msg_Answer', '');
  expect(flow('Msg_Answer').messageRef).toBeUndefined();
  expect(roots('bpmn:Message')).toHaveLength(1);
  expect(roots('bpmn:ItemDefinition')).toHaveLength(2);

  const doc = yaml.load(study.toYaml()) as Record<string, any>;
  expect(doc.C.messageFlows.Msg_Trial.messageRef).toBe('Message_behaverse_Trial');
  expect(doc.Message_behaverse_Trial).toMatchObject({ type: 'Message', itemRef: 'ItemDefinition_behaverse_Trial' });
  expect(doc.ItemDefinition_behaverse_Trial).toMatchObject({ type: 'ItemDefinition', structureRef: 'behaverse:Trial' });
});
