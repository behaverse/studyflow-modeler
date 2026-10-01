import type { Issue } from '@core/checks';
import { explore, planOf } from '@core/engine';
import type { StudyModel } from '@core/model/index';

/**
 * Soundness: every way the study can go ends, and ends properly: no pool waits for a message the other never sends,
 * no parallel join waits for a token that can never come, and no message is sent that nothing takes. The study's runs are explored (`packages/core/src/engine/explore.ts`)
 * with every decision a free choice, so a finding may lie on a path its conditions never take: it is a warning, with
 * the choices that lead to it.
 */
export async function checkSoundness(model: StudyModel): Promise<{ issues: Issue[]; note?: string }> {
  let plan;
  try {
    plan = planOf(model);
  } catch {
    return { issues: [] }; // a study the walk cannot plan is reported by the plan checks
  }
  let exploration;
  try {
    exploration = await explore(plan);
  } catch (error) {
    // What stops a walk before it starts (an allocation it cannot apply) stops the exploration too.
    return { issues: [{ severity: 'warning', message: `soundness was not checked: ${(error as Error).message}` }] };
  }
  const { runs, complete, findings } = exploration;
  const issues: Issue[] = findings.map(({ message, path }) => ({
    severity: 'warning',
    message: `${message}${path.length > 0 ? `, when ${path.join(', ')}` : ''}`,
  }));
  if (!complete) issues.push({ severity: 'warning', message: `soundness was checked on the first ${runs} ways the study can go, not on every one` });
  return { issues, note: complete && issues.length === 0 ? `sound over ${runs === 1 ? 'the one way' : `the ${runs} ways`} it can go` : undefined };
}
