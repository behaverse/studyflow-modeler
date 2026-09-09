import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { studyflowToDefinitions, xmlToStudyflow } from '@core/document';
import { buildCatalog, setCatalog } from '@core/notation';
import { toModdlePackages } from '@core/notation/schemaFile';
import type { Editor } from '@modeler/editor/port';
import { runUpdateMessage } from '@modeler/inspector/commands';
import { messageStructureOf, messageStructureOptions } from '@modeler/inspector/stateProperties';
import { loadSchemaModels } from './schemas';

/** A message flow's Message field: `messageRef` -> `bpmn:Message` -> `itemRef` -> `bpmn:ItemDefinition.structureRef`. */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const moddle = () => new BpmnModdle(structuredClone(packages)) as any;

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
  const m = moddle();
  const definitions = studyflowToDefinitions(FILE, m, () => {});
  const collaboration = definitions.rootElements.find((re: any) => re.$type === 'bpmn:Collaboration');
  const [trial, answer] = collaboration.messageFlows;
  const editor = editorOver(m);
  const roots = (type: string) => definitions.rootElements.filter((re: any) => re.$type === type);

  // The schema's structures come first; the file's own item definitions follow.
  expect(messageStructureOptions(trial)).toEqual(['behaverse:Trial', 'behaverse:Response']);
  expect(messageStructureOf(trial)).toBe('');

  runUpdateMessage(editor, { type: 'UpdateMessage', element: trial, structureRef: 'behaverse:Trial' });
  expect(messageStructureOf(trial)).toBe('behaverse:Trial');
  expect(roots('bpmn:Message')).toHaveLength(1);
  expect(roots('bpmn:ItemDefinition').map((re: any) => re.structureRef)).toEqual(['behaverse:Trial']);

  // A second flow with the same structure shares the message; a structure typed in gets one of its own.
  runUpdateMessage(editor, { type: 'UpdateMessage', element: answer, structureRef: 'behaverse:Trial' });
  expect(answer.messageRef).toBe(trial.messageRef);
  runUpdateMessage(editor, { type: 'UpdateMessage', element: answer, structureRef: 'lab:Ping' });
  expect(roots('bpmn:Message')).toHaveLength(2);
  expect(messageStructureOptions(trial)).toEqual(['behaverse:Trial', 'behaverse:Response', 'lab:Ping']);

  // Clearing drops the message no flow carries any more; its item definition stays (a property may be typed by it).
  runUpdateMessage(editor, { type: 'UpdateMessage', element: answer, structureRef: '' });
  expect(answer.messageRef).toBeUndefined();
  expect(roots('bpmn:Message')).toHaveLength(1);
  expect(roots('bpmn:ItemDefinition')).toHaveLength(2);

  const text = await xmlToStudyflow((await m.toXML(definitions, { format: true })).xml, moddle());
  expect(text).toContain('messageRef: Message_behaverse_Trial\n');
  expect(text).toContain('Message_behaverse_Trial:\n  type: Message\n  itemRef: ItemDefinition_behaverse_Trial\n');
  expect(text).toContain('ItemDefinition_behaverse_Trial:\n  type: ItemDefinition\n  structureRef: behaverse:Trial\n');
});
