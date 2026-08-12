import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';

import { YAML_DUMP_OPTIONS, xmlToStudyflow } from '@core/document';
import type { ImportedStudy, ImportedTask } from '@modeler/import/jspsych';

const LAYOUT = {
  startX: 160,
  gap: 60,
  laneY: 200,
  eventSize: 36,
  taskWidth: 100,
  taskHeight: 80,
} as const;


type LaidOut = { el: any; x: number; y: number; width: number; height: number };

export async function buildStudyflowXml(study: ImportedStudy, packages: Record<string, any>): Promise<string> {
  // Flattened value-typed bodies make moddle XML-escape `<`/`&`; clone because moddle mutates its packages in place.
  const moddle = new BpmnModdle(structuredClone(packages)) as any;

  const flowElements: any[] = [];
  const laidOut: LaidOut[] = [];
  let cursorX = LAYOUT.startX;

  const place = (el: any, width: number, height: number): void => {
    laidOut.push({ el, x: cursorX, y: LAYOUT.laneY - height / 2, width, height });
    cursorX += width + LAYOUT.gap;
  };

  const start = moddle.create('bpmn:StartEvent', { id: 'Start', name: 'Start' });
  if (study.consentFormUri) start.set('studyflow:consentFormUri', study.consentFormUri);
  flowElements.push(start);
  place(start, LAYOUT.eventSize, LAYOUT.eventSize);

  const taskEls: any[] = study.tasks.map((task) => {
    const el = buildTask(moddle, task);
    flowElements.push(el);
    place(el, LAYOUT.taskWidth, LAYOUT.taskHeight);
    return el;
  });

  const end = moddle.create('bpmn:EndEvent', { id: 'End', name: 'End' });
  flowElements.push(end);
  place(end, LAYOUT.eventSize, LAYOUT.eventSize);

  const chain = [start, ...taskEls, end];
  const flows: any[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const source = chain[i];
    const target = chain[i + 1];
    const flow = moddle.create('bpmn:SequenceFlow', {
      id: `Flow_${source.id}_${target.id}`,
      sourceRef: source,
      targetRef: target,
    });
    source.get('outgoing').push(flow);
    target.get('incoming').push(flow);
    flows.push(flow);
    flowElements.push(flow);
  }

  const process = moddle.create('bpmn:Process', {
    id: study.processId,
    name: study.name,
    isExecutable: true,
    extensionElements: moddle.create('bpmn:ExtensionElements', { values: [moddle.create('studyflow:Study', {})] }),
    flowElements,
  });

  const diagram = buildDiagram(moddle, process, laidOut, flows);

  const definitions = moddle.create('bpmn:Definitions', {
    id: study.id,
    targetNamespace: 'http://bpmn.io/schema/bpmn',
    rootElements: [process],
    diagrams: [diagram],
  });

  const { xml } = await moddle.toXML(definitions, { format: true });
  return xml;
}

export async function buildStudyflowYaml(study: ImportedStudy, packages: Record<string, any>): Promise<string> {
  const xml = await buildStudyflowXml(study, packages);
  const moddle = new BpmnModdle(structuredClone(packages)) as any;
  return xmlToStudyflow(xml, moddle);
}

function buildTask(moddle: any, task: ImportedTask): any {
  const configYaml = yaml.dump(task.configurations, YAML_DUMP_OPTIONS);
  const cognitiveTask = moddle.create('cognitive:CognitiveTask', {
    instrument: task.instrument,
    configurations: moddle.create('cognitive:Configurations', { value: configYaml }),
  });

  const el = moddle.create('bpmn:UserTask', {
    id: task.id,
    name: task.name,
    implementation: task.functionRef,
    extensionElements: moddle.create('bpmn:ExtensionElements', { values: [cognitiveTask] }),
  });
  return el;
}

function buildDiagram(moddle: any, process: any, laidOut: LaidOut[], flows: any[]): any {
  const centers = new Map<string, { left: { x: number; y: number }; right: { x: number; y: number } }>();

  const shapes = laidOut.map(({ el, x, y, width, height }) => {
    centers.set(el.id, {
      left: { x, y: y + height / 2 },
      right: { x: x + width, y: y + height / 2 },
    });
    return moddle.create('bpmndi:BPMNShape', {
      id: `${el.id}_di`,
      bpmnElement: el,
      bounds: moddle.create('dc:Bounds', { x, y, width, height }),
    });
  });

  const edges = flows.map((flow) => {
    const from = centers.get(flow.sourceRef.id)!.right;
    const to = centers.get(flow.targetRef.id)!.left;
    return moddle.create('bpmndi:BPMNEdge', {
      id: `${flow.id}_di`,
      bpmnElement: flow,
      waypoint: [moddle.create('dc:Point', { ...from }), moddle.create('dc:Point', { ...to })],
    });
  });

  const plane = moddle.create('bpmndi:BPMNPlane', {
    id: 'BPMNPlane_1',
    bpmnElement: process,
    planeElement: [...shapes, ...edges],
  });
  return moddle.create('bpmndi:BPMNDiagram', { id: 'BPMNDiagram_1', plane });
}
