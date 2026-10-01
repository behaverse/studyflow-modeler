import type { StudyModel } from '@core/model/index';
import { checkDataContract } from '@core/checks/data-contract';
import { checkDecisions } from '@core/checks/decisions';
import { checkValues } from '@core/checks/values';
import { checkExpressions } from '@core/checks/expressions';
import { checkFlowConsistency } from '@core/checks/flow-consistency';
import { checkIds } from '@core/checks/ids';
import { checkRunnerPaths } from '@core/checks/runner-paths';
import { checkSeal } from '@core/checks/seal';
import { checkConnected } from '@core/checks/connected';
import { checkEndpoints } from '@core/checks/endpoints';

/* What `studyflow validate` checks beyond reading a file, each check in a file of its own; `studyflow run` applies
   the plan checks before it starts a study. */

/** What a check reports, about the element `elementId` names when it is about one. */
export type Issue = {
  severity: 'error' | 'warning';
  elementId?: string;
  message: string;
};

/** The plan: one element an id, its edges between the elements they may join, sound, walkable, its expressions FEEL, its decisions exclusive, its choices listed, and reading only the columns its schemas define. */
export function planChecks(model: StudyModel): Issue[] {
  return [
    ...checkIds(model), ...checkEndpoints(model), ...checkConnected(model), ...checkRunnerPaths(model), ...checkExpressions(model), ...checkDecisions(model),
    ...checkValues(model), ...checkDataContract(model),
  ];
}

/** What a run left in the file: counts that balance, and a protocol that is still the one it ran; `note` says it is. */
export async function recordChecks(model: StudyModel): Promise<{ issues: Issue[]; note?: string }> {
  const seal = await checkSeal(model);
  return { issues: [...checkFlowConsistency(model), ...seal.issues], note: seal.note };
}
