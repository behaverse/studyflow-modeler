import type { Studyflow } from '@runner/studyflow';
import type { ValidationIssue } from '@runner/nodes/types';

/**
 * What the notation says that this runtime does not walk, refused before the first screen rather than walked as a
 * different study: a loop or a multi-instance marker, a boundary event, a message flow between pools, a data
 * association (whose value this runtime would not carry), a timer. The local runtime walks each of them
 * (`studyflow run --runtime local`); a study using them runs there.
 */
export function validateUnwalked(studyflow: Studyflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const locally = 'The local runtime walks it (`studyflow run --runtime local`).';
  // Every flow element, boundary events included, which never become flow nodes of this runtime's walk.
  const elements: any[] = [];
  const gather = (container: any) => {
    for (const element of container?.flowElements ?? []) {
      elements.push(element);
      gather(element);
    }
  };
  gather(studyflow.businessObject);
  for (const bo of elements) {
    const node = { id: bo.id as string };
    const label = bo.name || node.id;
    if (bo.loopCharacteristics) {
      issues.push({ nodeId: node.id, message: `'${label}' repeats under a loop marker, which this runtime does not walk: it would run once. ${locally}` });
    }
    if (bo.$type === 'bpmn:BoundaryEvent') {
      issues.push({ nodeId: node.id, message: `'${label}' is a boundary event, which this runtime does not watch: the step it sits on would never leave through it. ${locally}` });
    }
    if ((bo.eventDefinitions ?? []).some((definition: any) => definition?.$type === 'bpmn:TimerEventDefinition')) {
      issues.push({ nodeId: node.id, severity: 'warning', message: `'${label}' waits for a timer, which this runtime does not keep: it passes at once.` });
    }
    if ((bo.dataInputAssociations?.length ?? 0) + (bo.dataOutputAssociations?.length ?? 0) > 0) {
      issues.push({ nodeId: node.id, severity: 'warning', message: `'${label}' reads or writes data along drawn edges, which this runtime does not carry. ${locally}` });
    }
  }
  const definitions = studyflow.businessObject?.$parent;
  const flows = (definitions?.rootElements ?? []).flatMap((root: any) => (root.$type === 'bpmn:Collaboration' ? root.messageFlows ?? [] : []));
  if (flows.length > 0) {
    issues.push({ nodeId: flows[0].id, message: `This study exchanges messages between pools (${flows.length} message flow${flows.length === 1 ? '' : 's'}), which this runtime does not carry: it walks one process. ${locally}` });
  }
  return issues;
}
