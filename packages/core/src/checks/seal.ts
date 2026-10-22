import type { StudyModel } from '@core/model/index';
import { protocolDigest } from '@core/document/digest';
import type { Issue } from '@core/checks';

/** `sha256:` and the first 12 hex digits. */
const short = (digest: string): string => `${digest.slice(0, 'sha256:'.length + 12)}…`;

/**
 * The seal: the newest `executed` record on the study's root that names the protocol its run walked (`plan`),
 * against the protocol as the file has it now. A match is said as a note; a mismatch is a warning.
 */
export async function checkSeal(model: StudyModel): Promise<{ issues: Issue[]; note?: string }> {
  const root = model.primaryRoot();
  const record = (root ? model.entries(root) : []).findLast((entry) => entry.type === 'prov:Activity' && entry.action === 'executed' && typeof entry.plan === 'string') as { plan: string; run?: string } | undefined;
  if (!record) return { issues: [] };
  const now = await protocolDigest(model);
  if (now === record.plan) return { issues: [], note: `protocol matches run ${record.run} (${short(now)})` };
  return {
    issues: [{ severity: 'warning', message: `protocol changed since run ${record.run}: recorded ${short(record.plan)}, now ${short(now)}` }],
  };
}
