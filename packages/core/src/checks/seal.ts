import type { ModdleElement } from '@core/element/moddle';
import { META_KEY, readState } from '@core/document/state';
import { protocolDigest } from '@core/document/digest';
import type { Issue } from '@core/checks';

/** `sha256:` and the first 12 hex digits. */
const short = (digest: string): string => `${digest.slice(0, 'sha256:'.length + 12)}…`;

/**
 * The seal: the newest `executed` record in `state._meta.prov` that names the protocol its run walked (`plan`),
 * against the protocol as the file has it now. A match is said as a note; a mismatch is a warning.
 */
export async function checkSeal(definitions: ModdleElement): Promise<{ issues: Issue[]; note?: string }> {
  const prov = readState(definitions)[META_KEY]?.prov;
  const record = Array.isArray(prov) ? prov.findLast((entry) => entry?.action === 'executed' && typeof entry.plan === 'string') : undefined;
  if (!record) return { issues: [] };
  const now = await protocolDigest(definitions);
  if (now === record.plan) return { issues: [], note: `protocol matches run ${record.run} (${short(now)})` };
  return {
    issues: [{ severity: 'warning', message: `protocol changed since run ${record.run}: recorded ${short(record.plan)}, now ${short(now)}` }],
  };
}
