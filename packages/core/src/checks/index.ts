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
import { checkEntryExit } from '@core/checks/entry-exit';
import { checkWrites } from '@core/checks/writes';
import { checkConcealed, checkRevealed } from '@core/checks/concealed';
import { checkLabels } from '@core/checks/labels';
import { checkResults } from '@core/checks/results';

/* What `studyflow validate` checks beyond reading a file, each check in a file of its own; `studyflow run` applies
   the plan checks before it starts a study. */

/** What a check reports, about the element `elementId` names when it is about one. */
export type Issue = {
  severity: 'error' | 'warning';
  elementId?: string;
  message: string;
};

/** The plan: one element an id, its edges between the elements they may join, sound, walkable, its expressions FEEL, its decisions exclusive, its choices listed, a consent form to fetch and a completion code to hand, no two paths at once writing one value, reading only the columns its schemas define and only the result fields its steps' types declare, a concealed allocation registering a digest and being one a seed can conceal, and no name copying a value its element reads. */
export function planChecks(model: StudyModel): Issue[] {
  return [
    ...checkIds(model), ...checkEndpoints(model), ...checkConnected(model), ...checkRunnerPaths(model), ...checkExpressions(model), ...checkDecisions(model),
    ...checkValues(model), ...checkEntryExit(model), ...checkWrites(model), ...checkDataContract(model), ...checkConcealed(model), ...checkLabels(model),
    ...checkResults(model),
  ];
}

/** What a run left in the file: counts that balance, a protocol that is still the one it ran, and a concealed
 * allocation's seed that is the one it registered; `note` says what matched. */
export async function recordChecks(model: StudyModel): Promise<{ issues: Issue[]; note?: string }> {
  const seal = await checkSeal(model);
  const revealed = await checkRevealed(model);
  const note = [seal.note, revealed.note].filter(Boolean).join(', ') || undefined;
  return { issues: [...checkFlowConsistency(model), ...seal.issues, ...revealed.issues], note };
}
