import type { ModdleElement } from '@core/element/moddle';
import { checkDataContract } from '@core/checks/data-contract';
import { checkFlowConsistency } from '@core/checks/flow-consistency';
import { checkRunnerPaths } from '@core/checks/runner-paths';
import { checkSeal } from '@core/checks/seal';
import { checkSoundness } from '@core/checks/soundness';

/* What `studyflow validate` checks beyond reading a file, each check in a file of its own; `studyflow run` applies
   the plan checks before it starts a study. */

/** What a check reports, about the element `elementId` names when it is about one. */
export type Issue = {
  severity: 'error' | 'warning';
  elementId?: string;
  message: string;
};

/** The plan: sound, walkable by the reference runners, and reading only the columns its schemas define. */
export function planChecks(definitions: ModdleElement): Issue[] {
  return [...checkSoundness(definitions), ...checkRunnerPaths(definitions), ...checkDataContract(definitions)];
}

/** What a run left in the file: counts that balance, and a protocol that is still the one it ran; `note` says it is. */
export async function recordChecks(definitions: ModdleElement): Promise<{ issues: Issue[]; note?: string }> {
  const seal = await checkSeal(definitions);
  return { issues: [...checkFlowConsistency(definitions), ...seal.issues], note: seal.note };
}
