import { foldTyped, studyText } from '@core/model/yaml';
import type { Element, Study, Value } from '@core/model/index';
import type { Metamodel } from '@core/model/metamodel';

import type { ImportedStudy, ImportedTask } from './timeline';

const LAYOUT = {
  startX: 160,
  gap: 60,
  laneY: 200,
  eventSize: 36,
  taskWidth: 100,
  taskHeight: 80,
  dataWidth: 36,
  dataHeight: 50,
} as const;

type Point = { x: number; y: number };

const route = (points: Point[]): string => points.map(({ x, y }) => `${x},${y}`).join(' ');

/** An imported timeline as a `.studyflow.yaml`: start, a task per trial, end, in a row, each task's parameters wired in from below. */
export function buildStudyflowYaml(study: ImportedStudy, metamodel: Metamodel): string {
  const flowElements: Element[] = [];
  const layout: Study['layout'] = {};
  const sides = new Map<string, { left: Point; right: Point }>();
  let cursorX = LAYOUT.startX;

  const place = (element: Element, width: number, height: number): void => {
    layout[element.id!] = { bounds: `${cursorX} ${LAYOUT.laneY - height / 2} ${width} ${height}` };
    sides.set(element.id!, { left: { x: cursorX, y: LAYOUT.laneY }, right: { x: cursorX + width, y: LAYOUT.laneY } });
    cursorX += width + LAYOUT.gap;
  };

  const start: Element = { type: 'bpmn:StartEvent', id: 'Start', name: 'Start' };
  if (study.consentFormUri) start.consentFormUri = study.consentFormUri;
  flowElements.push(start);
  place(start, LAYOUT.eventSize, LAYOUT.eventSize);

  // Each task reads its trial's parameters from a Parameters object wired in from below.
  const tasks = study.tasks.map((task) => {
    const element = foldTyped(metamodel, taskOf(task));
    flowElements.push(element);
    const center = cursorX + LAYOUT.taskWidth / 2;
    place(element, LAYOUT.taskWidth, LAYOUT.taskHeight);
    if (Object.keys(task.parameters).length > 0) {
      const parameters: Element = { type: 'studyflow:Parameters', id: `${task.id}_Parameters`, name: 'Parameters', values: task.parameters as Value };
      const association: Element = { type: 'bpmn:DataInputAssociation', id: `In_${parameters.id}`, sourceRef: [parameters.id!] };
      element.dataInputAssociations = [association];
      flowElements.push(parameters);
      const bottom = LAYOUT.laneY + LAYOUT.taskHeight / 2;
      const top = bottom + LAYOUT.gap;
      layout[parameters.id!] = { bounds: `${center - LAYOUT.dataWidth / 2} ${top} ${LAYOUT.dataWidth} ${LAYOUT.dataHeight}` };
      layout[association.id!] = { waypoint: route([{ x: center, y: top }, { x: center, y: bottom }]) };
    }
    return element;
  });

  const end: Element = { type: 'bpmn:EndEvent', id: 'End', name: 'End' };
  flowElements.push(end);
  place(end, LAYOUT.eventSize, LAYOUT.eventSize);

  const chain = [start, ...tasks, end];
  for (let i = 0; i < chain.length - 1; i++) {
    const [source, target] = [chain[i].id!, chain[i + 1].id!];
    const id = `Flow_${source}_${target}`;
    flowElements.push({ type: 'bpmn:SequenceFlow', id, sourceRef: source, targetRef: target });
    layout[id] = { waypoint: route([sides.get(source)!.right, sides.get(target)!.left]) };
  }

  const process: Element = { type: 'studyflow:Study', id: study.processId, name: study.name, isExecutable: true, flowElements };
  return studyText({ id: study.id, definitions: { targetNamespace: 'http://bpmn.io/schema/bpmn' }, roots: [process], layout }, metamodel);
}

function taskOf(task: ImportedTask): Element {
  return {
    type: 'bpmn:UserTask',
    id: task.id,
    name: task.name,
    implementation: task.functionRef,
    extensionElements: [{ type: 'cognitive:CognitiveTask', platform: task.platform }],
  };
}
