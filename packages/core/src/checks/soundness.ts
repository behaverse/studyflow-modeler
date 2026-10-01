import type { ModdleElement } from '@core/element/moddle';
import type { Issue } from '@core/checks';
import { explore, planOf } from '@core/engine';

/**
 * Soundness: every way the study can go ends, and ends properly. Each pool is one path, so a connected study
 * (`connected.ts`) is sound within a pool; what is left is between pools, where one waits for a message the other
 * never sends, and a message sent that nothing takes. The study's runs are explored (`packages/core/src/engine/explore.ts`)
 * with every decision a free choice, so a finding may lie on a path its conditions never take: it is a warning, with
 * the choices that lead to it.
 */
export async function checkSoundness(definitions: ModdleElement): Promise<{ issues: Issue[]; note?: string }> {
  let plan;
  try {
    plan = planOf(definitions);
  } catch {
    return { issues: [] }; // a study the walk cannot plan is reported by the plan checks
  }
  const { runs, complete, findings } = await explore(plan);
  const issues: Issue[] = findings.map(({ message, path }) => ({
    severity: 'warning',
    message: `${message}${path.length > 0 ? `, when ${path.join(', ')}` : ''}`,
  }));
  if (!complete) issues.push({ severity: 'warning', message: `soundness was checked on the first ${runs} ways the study can go, not on every one` });
  return { issues, note: complete && issues.length === 0 ? `sound over the ${runs} ways it can go` : undefined };
}
