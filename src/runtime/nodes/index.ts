import type { Process } from '../types';
import type { Manifest, ValidationIssue } from './behaverse/types';

import { validate as validateStart } from './start';
import { validate as validateEnd } from './end';
import { validate as validateInstruction } from './instruction';
import { validate as validateQuestionnaire } from './questionnaire';
import { validate as validateBehaverse } from './behaverse';

export { Start, startToJob, type StartJob } from './start';
export { End, endToJob, type EndJob } from './end';
export { Instruction, instructionToJob, type InstructionJob } from './instruction';
export { Questionnaire, questionnaireToJob, type QuestionnaireJob } from './questionnaire';
export { Task, taskToJob, type TaskJob } from './task';
export {
  Behaverse,
  behaverseToJob,
  fetchManifest,
  BEHAVERSE_RUNTIME_URL,
  type BehaverseJob,
} from './behaverse';

/**
 * Aggregate validation across every node kind. Each kind's `validate()`
 * contributes its own issues.
 */
export function validate(process: Process, manifest?: Manifest): ValidationIssue[] {
  return [
    validateStart(process),
    validateEnd(process),
    validateInstruction(process),
    validateQuestionnaire(process),
    validateBehaverse(process, manifest),
  ].flat();
}

/**
 * True when at least one node in the process applies the Behaverse type.
 * The executor uses this to decide whether to fetch the Unity manifest
 * (which fails if the Unity build isn't deployed).
 */
export function requiresBehaverseRuntime(process: Process): boolean {
  for (const node of process.nodes.values()) {
    if (node.appliedType === 'behaverse:BehaverseTask') return true;
  }
  return false;
}
