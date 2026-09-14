import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { fromWireXml, studyflowToDefinitions, studyflowToXml, xmlToStudyflow } from '@core/document';
import { exampleNames as examples, exampleText } from '@tests/utils';
import { freshModdle } from '@tests/schemas';

/** The `.studyflow.yaml` spelling: the short forms the writer emits, every shipped file spelled that way, and the long forms the reader still takes. */

const STATE_PROPERTIES_FIXTURE = path.join(process.cwd(), 'packages/core/tests/fixtures/state-properties.studyflow.yaml');

test.describe('studyflow YAML format', () => {
  test('the long spellings still load: value wrappers, an element list, a diagram section, geometry as mappings', async () => {
    const legacy = `
definitions:
  id: legacy_demo
  targetNamespace: http://bpmn.io/schema/bpmn
  xmlns:studyflow: http://behaverse.org/schemas/studyflow/v1
elements:
  - type: bpmn:Process
    id: P
    extensionElements:
      values:
        - type: studyflow:Study
    flowElements:
      - type: bpmn:StartEvent
        id: Start
        outgoing: [F1]
      - type: bpmn:Task
        id: T1
        bounds: { x: 100, "y": 0, width: 100, height: 80 }
        extensionElements:
          values:
            - type: cognitive:CognitiveTask
              instrument: jspsych
              configurations:
                value: |
                  Timelines:
                    XCIT_NB_01:
        incoming: [F1]
        outgoing: [F2]
      - type: bpmn:EndEvent
        id: End
        incoming: [F2]
      - type: bpmn:SequenceFlow
        id: F1
        sourceRef: Start
        targetRef: T1
        waypoint: [{ x: 36, "y": 18 }, { x: 100, "y": 18 }]
      - type: bpmn:SequenceFlow
        id: F2
        sourceRef: T1
        targetRef: End
diagram:
  - id: BPMNDiagram_1
    plane:
      id: BPMNPlane_1
      bpmnElement: P
      planeElement:
        - type: bpmndi:BPMNShape
          id: Start_di
          bpmnElement: Start
          bounds: { x: 160, "y": 180, width: 36, height: 36 }
`;
    const xml = await studyflowToXml(legacy, freshModdle());
    expect(xml).toContain('XCIT_NB_01');
    expect(xml).toContain('Start_di');

    const doc: any = yaml.load(await xmlToStudyflow(xml, freshModdle()));
    expect(doc.id).toBe('legacy_demo');
    expect(doc.definitions['xmlns:studyflow']).toBeUndefined();
    expect(doc.diagram).toBeUndefined();
    const process = doc.P;
    expect(Array.isArray(process.extensionElements)).toBe(true);
    expect(process.flowElements.T1.extensionElements[0].configurations.Timelines).toBeDefined();
    expect(process.flowElements.Start.bounds).toBe('160 180 36 36');
    expect(process.flowElements.T1.bounds).toBe('100 0 100 80');
    expect(process.flowElements.F1.waypoint).toBe('36,18 100,18');
  });

  test('the short spellings: bare types, implied flow types, one-line geometry, arrows, one key per colour', async () => {
    const doc = `
id: short_demo
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    Start:
      type: StartEvent
      bounds: 0 0 36 36
    T1:
      type: Task
      name: Read
      bounds: 100 0 100 80
      fill: "#dbe8f5"
      stroke: "#4a6f9c"
      font: "bold right #4a6f9c"
    End:
      type: EndEvent
      bounds: 300 0 36 36
      label: 290 40 56 14
    F1: Start -> T1
    F2:
      name: done
      sourceRef: T1
      targetRef: End
      waypoint: 200,40 300,40
  artifacts:
    Note_1:
      text: hello
    Assoc_1: Note_1 -> T1
`;
    const moddle = freshModdle();
    const xml = await studyflowToXml(doc, moddle);
    expect(xml).toMatch(/<bpmn2?:task id="T1" name="Read">/);
    expect(xml).toMatch(/<bpmn2?:sequenceFlow id="F1" sourceRef="Start" targetRef="T1" \/>/);
    expect(xml).toMatch(/<bpmn2?:sequenceFlow id="F2" name="done" sourceRef="T1" targetRef="End" \/>/);
    expect(xml).toMatch(/<bpmn2?:textAnnotation id="Note_1">/);
    expect(xml).toMatch(/<bpmn2?:association id="Assoc_1" sourceRef="Note_1" targetRef="T1" \/>/);
    // Implied by the flows, so derived on load.
    expect(xml).toMatch(/:outgoing>F1</);
    expect(xml).toMatch(/:incoming>F1</);
    expect(xml).toMatch(/<dc:Bounds x="100" y="0" width="100" height="80" \/>/);
    expect(xml).toMatch(/<di:waypoint x="200" y="40" \/>/);
    expect(xml).toMatch(/<bpmndi:BPMNLabel>\s*<dc:Bounds x="290" y="40" width="56" height="14" \/>/);
    // One colour key writes both DI vocabularies.
    expect(xml).toContain('color:background-color="#dbe8f5"');
    expect(xml).toContain('bioc:fill="#dbe8f5"');
    expect(xml).toContain('color:border-color="#4a6f9c"');
    expect(xml).toContain('bioc:stroke="#4a6f9c"');
    expect(xml).toContain('studyflow:font="bold right #4a6f9c"');

    const back: any = yaml.load(await xmlToStudyflow(xml, freshModdle()));
    expect(back.P.flowElements.T1).toMatchObject({ fill: '#dbe8f5', stroke: '#4a6f9c', font: 'bold right #4a6f9c' });
    expect(back.P.flowElements.F1).toBe('Start -> T1');
    expect(back.P.artifacts.Assoc_1).toBe('Note_1 -> T1');
  });

  test('a config body carrying XML-unsafe markup round-trips XML <-> YAML', async () => {
    // moddle escapes a text body only when it is typed exactly `String`; raw `<`/`&` would break the export.
    const doc = `
id: escape_demo
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: bpmn:Process
  flowElements:
    T1:
      type: bpmn:Task
      extensionElements:
        - type: cognitive:CognitiveTask
          instrument: jspsych
          configurations:
            stimulus: "<p>&lt; L &amp; R <<< </p>"
`;
    const xml = await studyflowToXml(doc, freshModdle());
    expect(xml).not.toContain('<<<');

    const back: any = yaml.load(await xmlToStudyflow(xml, freshModdle()));
    expect(back.P.flowElements.T1.extensionElements[0].configurations.stimulus).toBe('<p>&lt; L &amp; R <<< </p>');
  });

  test('a config body with a comment keeps its long form, so the comment survives a round trip', async () => {
    // Folded into a mapping, the body would come back without its comment.
    const configurations = 'triggerChannel: markers  # sent with the biosignals';
    const doc = `
id: comment_demo
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    T1:
      type: Task
      extensionElements:
        - type: cognitive:CognitiveTask
          instrument: psychopy
          configurations:
            value: "${configurations}"
`;
    const xml = await studyflowToXml(doc, freshModdle());
    expect(xml).toContain(configurations);
    const back: any = yaml.load(await xmlToStudyflow(xml, freshModdle()));
    expect(back.P.flowElements.T1.extensionElements[0].configurations).toEqual({ value: configurations });
  });

  test('a message flow names its message, and the message its item definition, through a round trip', async () => {
    const text = `id: msg
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Screen:
      processRef: S
    Robot:
      processRef: R
  messageFlows:
    Msg_Trial:
      sourceRef: Play
      targetRef: Answer
      messageRef: Trial
Trial:
  type: Message
  itemRef: Trial_Item
Trial_Item:
  type: ItemDefinition
  structureRef: behaverse:Trial
S:
  type: Process
  flowElements:
    Play:
      type: Task
R:
  type: Process
  flowElements:
    Answer:
      type: ReceiveTask
`;
    const xml = await studyflowToXml(text, freshModdle());
    expect(xml).toContain('messageRef="Trial"');
    expect(xml).toContain('<bpmn:message id="Trial" itemRef="Trial_Item" />');
    expect(xml).toContain('<bpmn:itemDefinition id="Trial_Item" structureRef="behaverse:Trial" />');
    const back = await xmlToStudyflow(xml, freshModdle());
    expect(back).toContain('messageRef: Trial\n');
    expect(back).toContain('Trial:\n  type: Message\n  itemRef: Trial_Item\n');
    expect(back).toContain('Trial_Item:\n  type: ItemDefinition\n  structureRef: behaverse:Trial\n');
  });

  test('a pool diagram with no `diagram:` node draws its collaboration, whose Study takes the state', () => {
    const definitions = studyflowToDefinitions(`id: pools
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  extensionElements:
    - type: studyflow:Study
  participants:
    Pool:
      processRef: P
      bounds: 0 0 600 250
P:
  type: Process
  flowElements:
    Start:
      type: StartEvent
      bounds: 100 100 36 36
state:
  Start:
    count: 1
`, freshModdle());
    const [collaboration, process] = definitions.rootElements;
    expect(definitions.diagrams[0].plane.bpmnElement).toBe(collaboration);
    expect(JSON.parse(collaboration.extensionElements.values[0].state)).toEqual({ Start: { count: 1 } });
    expect(process.extensionElements).toBeUndefined();
  });

  test('an id two elements share is reported: a reference to it could reach only one', () => {
    const warnings: string[] = [];
    studyflowToDefinitions({ definitions: {}, elements: {
      Outer: { type: 'SubProcess', flowElements: { Twin: { type: 'Task' }, Inner: { type: 'SubProcess', flowElements: { Twin: { type: 'Task' } } } } },
    } }, freshModdle(), (message) => warnings.push(message));
    expect(warnings).toEqual(["the id 'Twin' names two elements; a reference to it reaches only the last"]);
  });

  test('`studyflow validate` flags the attributes the modeler flags on open, and the own `icon` and `font` are declared', async () => {
    const moddle = freshModdle();
    const text = `id: s
definitions: {}
Study:
  type: Process
  flowElements:
    Game:
      type: ChoreographyTask
      extensionElements:
        - type: cognitive:CognitiveTask
          icon: iconify ph--game-controller
    Chain:
      type: SubProcess
      studyflow:icon: iconify ph--link
      studyflow:colour: red
      bounds: 0 0 100 80
      font: bold
`;
    // The CLI reads the YAML alone; the modeler then reads the XML written from it with moddle's reader.
    const read: string[] = [];
    const xml = await studyflowToXml(text, moddle, (message) => read.push(message));
    const opened: string[] = [];
    await fromWireXml(xml, moddle, (message) => opened.push(message));

    expect(read).toEqual(['unknown attribute <studyflow:colour> on bpmn:SubProcess']);
    expect(opened).toEqual(['Chain: unknown attribute <studyflow:colour>']);
    expect(xml).toContain('<cognitive:cognitiveTask studyflow:icon="iconify ph--game-controller"');
    expect(xml).toContain('studyflow:icon="iconify ph--link"');
  });

  test('a flow node at the top level, which BPMN drops, is flagged by `studyflow validate` as by the modeler on open', async () => {
    const moddle = freshModdle();
    const text = `id: s
definitions: {}
Study:
  type: Process
  flowElements:
    Start:
      type: StartEvent
Loose:
  type: ServiceTask
`;
    const read: string[] = [];
    const xml = await studyflowToXml(text, moddle, (message) => read.push(message));
    const opened: string[] = [];
    await fromWireXml(xml, moddle, (message) => opened.push(message));

    expect(read).toEqual(["unrecognized element <bpmn:ServiceTask> 'Loose' at the top level, which holds only root elements such as a process or a collaboration"]);
    expect(opened).toEqual([expect.stringContaining('unrecognized element <bpmn:serviceTask>')]);
  });

  // A PNG example is read by the YAML it embeds, so every example is held to the writer's spelling.
  for (const [name, read] of [
    ...examples.map((example) => [example, () => exampleText(example)] as const),
    ['the state-properties fixture', () => readFileSync(STATE_PROPERTIES_FIXTURE, 'utf8')] as const,
  ]) {
    test(`${name}: spelled the way the modeler writes it`, async () => {
      const text = read();
      expect(await xmlToStudyflow(await studyflowToXml(text, freshModdle()), freshModdle())).toBe(text);
    });
  }
});
