/**
 * `ImportedStudy` -> `.studyflow` (YAML).
 *
 * Assembles the intermediate model into a moddle Definitions tree: a start
 * event (carrying `studyflow:consentFormUri` when the timeline had consent),
 * one `bpmn:Task` per imported task with a `cognitive:cognitiveTask` wrapper
 * (`instrument`, inline `configurations`) and a `studyflow:uses` reference
 * naming the implementing software, an end event, and the sequence flows
 * chaining them. A trivial left-to-right auto-layout supplies the BPMN DI so
 * the file opens rendered in the modeler and any BPMN tool.
 *
 * `buildStudyflow` returns the `.studyflow` YAML serialization (the modern
 * format); `buildStudyflowXml` returns the equivalent BPMN 2.0 XML. Like
 * `parseStudyflow.ts`, this uses `bpmn-moddle` strictly as the XML codec;
 * schema semantics live in the catalog everywhere else.
 */

import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';

import { xmlToStudyflow } from '@/core/codec';
import type { ImportedStudy, ImportedTask } from '@/modeler/models/import/jspsych';

/** Deterministic horizontal layout; mirrors the geometry bundled examples use. */
const LAYOUT = {
  startX: 160,
  gap: 60,
  laneY: 200,
  eventSize: 36,
  taskWidth: 100,
  taskHeight: 80,
} as const;

const YAML_DUMP_OPTIONS: yaml.DumpOptions = { noRefs: true, lineWidth: 120, quotingType: '"' };

type LaidOut = { el: any; x: number; y: number; width: number; height: number };

/**
 * Build a `.studyflow` XML string from an imported study.
 *
 * `packages` are the moddle schema packages (`toModdlePackages` output, keyed
 * by prefix) — the same object `parseStudyflow` and the app construct their
 * `BpmnModdle` from. Callers that already loaded schemas pass them straight in.
 */
export async function buildStudyflowXml(study: ImportedStudy, packages: Record<string, any>): Promise<string> {
  // `toModdlePackages` flattens value-typed bodies (`cognitive:Configurations#
  // value`, ...) to plain `String`, which is what makes moddle XML-escape a body
  // carrying `<`/`&` — routine in jsPsych stimuli. Clone because moddle mutates
  // its packages in place (callers may share them).
  const moddle = new BpmnModdle(structuredClone(packages)) as any;

  const flowElements: any[] = [];
  const laidOut: LaidOut[] = [];
  let cursorX = LAYOUT.startX;

  const place = (el: any, width: number, height: number): void => {
    laidOut.push({ el, x: cursorX, y: LAYOUT.laneY - height / 2, width, height });
    cursorX += width + LAYOUT.gap;
  };

  // Start event (with consent link when the timeline had one).
  const start = moddle.create('bpmn:StartEvent', { id: 'Start', name: 'Start' });
  if (study.consentFormUri) start.set('studyflow:consentFormUri', study.consentFormUri);
  flowElements.push(start);
  place(start, LAYOUT.eventSize, LAYOUT.eventSize);

  // One cognitive task per imported node.
  const taskEls: any[] = study.tasks.map((task) => {
    const el = buildTask(moddle, task);
    flowElements.push(el);
    place(el, LAYOUT.taskWidth, LAYOUT.taskHeight);
    return el;
  });

  const end = moddle.create('bpmn:EndEvent', { id: 'End', name: 'End' });
  flowElements.push(end);
  place(end, LAYOUT.eventSize, LAYOUT.eventSize);

  // Chain: Start -> task_1 -> ... -> task_n -> End.
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

/**
 * Build the `.studyflow` YAML serialization from an imported study — the
 * modern format the modeler writes on save. Assembles BPMN 2.0 XML, then folds
 * it to YAML with the shared codec (config bodies inline as nested YAML,
 * diagram geometry attaches to its element).
 */
export async function buildStudyflowYaml(study: ImportedStudy, packages: Record<string, any>): Promise<string> {
  const xml = await buildStudyflowXml(study, packages);
  // A fresh moddle: the codec reads the authored body value-types to inline
  // YAML bodies, and moddle mutates the packages it is constructed from.
  const moddle = new BpmnModdle(structuredClone(packages)) as any;
  return xmlToStudyflow(xml, moddle);
}

function buildTask(moddle: any, task: ImportedTask): any {
  const configYaml = yaml.dump(task.configurations, YAML_DUMP_OPTIONS);
  const cognitiveTask = moddle.create('cognitive:CognitiveTask', {
    instrument: task.instrument,
    configurations: moddle.create('cognitive:Configurations', { value: configYaml }),
  });

  const el = moddle.create('bpmn:Task', {
    id: task.id,
    name: task.name,
    extensionElements: moddle.create('bpmn:ExtensionElements', { values: [cognitiveTask] }),
  });
  // Versioned reference to the implementing software: the general-purpose
  // `studyflow:uses` trait on the activity (jspsych://, docker://, https://, ...).
  el.set('studyflow:uses', task.functionRef);
  return el;
}

/** Build the single BPMN diagram: shapes for nodes, edges for flows. */
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
