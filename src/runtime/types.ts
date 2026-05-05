// Naming contract:
//   FlowNode     — BPMN executable vertex (Task / Event / Gateway). Data, parsed from XML.
//   SequenceFlow — BPMN edge connecting two FlowNodes.
//   Process      — the parsed BPMN process: nodes + sequence flows + start id.
//   Job          — one materialized unit yielded by Graph.traverse() — the FlowNode
//                  plus per-kind extras the renderer needs.

export type FlowNode = {
  id: string;
  type: string;
  appliedType?: string;
  businessObject: any;
  outgoing: string[];
  incoming: string[];
};

export type SequenceFlow = {
  id: string;
  sourceId: string;
  targetId: string;
  conditionExpression?: string;
  businessObject: any;
};

export type Process = {
  businessObject: any;
  nodes: Map<string, FlowNode>;
  edges: Map<string, SequenceFlow>;
  startId?: string;
};

import type { StartJob } from './nodes/start';
import type { EndJob } from './nodes/end';
import type { InstructionJob } from './nodes/instruction';
import type { QuestionnaireJob } from './nodes/questionnaire';
import type { TaskJob } from './nodes/task';
import type { BehaverseJob } from './nodes/behaverse';

export type Job =
  | StartJob
  | EndJob
  | InstructionJob
  | QuestionnaireJob
  | TaskJob
  | BehaverseJob;
