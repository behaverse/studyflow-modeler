import type { Issue } from '@core/checks';
import { seedDigestOf } from '@core/engine/allocation';
import { planElement } from '@core/engine/plan';
import { isElement, type Element, type StudyModel } from '@core/model/index';

/** `sha256:` and 64 hex digits, as `seedDigestOf` writes a digest. */
const DIGEST = /^sha256:[0-9a-f]{64}$/;

type Concealing = { id: string; label: string; digest: string; algorithm: string; element: Element };

/** The random gateways that conceal their allocation: those with a `seedDigest`. */
function concealing(model: StudyModel): Concealing[] {
  const found: Concealing[] = [];
  for (const element of model.all()) {
    if (!element.id || model.host(element) !== 'bpmn:ExclusiveGateway') continue;
    const plan = planElement(model, element);
    const attributes = plan.extensions[0]?.attributes ?? {};
    const digest = attributes.seedDigest;
    if (plan.branching !== 'random' || typeof digest !== 'string' || !digest) continue;
    const algorithm = typeof attributes.algorithm === 'string' ? attributes.algorithm : 'simple';
    found.push({ id: element.id, label: plan.name || element.id, digest, algorithm, element });
  }
  return found;
}

/**
 * A concealed allocation registers a digest a run can hold its seed against, and is one a seed can conceal:
 * alternation deals the arms in turn, so whoever saw the participants before can foresee the next arm whatever the
 * seed.
 */
export function checkConcealed(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  for (const { id, label, digest, algorithm } of concealing(model)) {
    if (!DIGEST.test(digest)) {
      issues.push({ severity: 'error', elementId: id, message: `${JSON.stringify(id)} has seedDigest: ${JSON.stringify(digest)}, which is not `
        + 'a digest: `sha256:` and 64 lowercase hex digits, the SHA-256 of the seed\'s text' });
    }
    if (algorithm === 'alternation') {
      issues.push({ severity: 'error', elementId: id, message: `'${label}' conceals an allocation by alternation, which anyone who saw the `
        + 'participants before can foresee whatever the seed: conceal a simple or a block allocation, or drop seedDigest' });
    }
  }
  return issues;
}

/** The seed a run revealed on a gateway that conceals its allocation: its newest `executed` record's `allocationSeed`. */
export function revealedSeed(element: Element): string | undefined {
  const values = Array.isArray(element.extensionElements) ? element.extensionElements : [];
  const revealed = values.filter((value): value is Element => isElement(value) && value.type === 'prov:Activity'
    && value.action === 'executed' && typeof value.allocationSeed === 'string' && value.allocationSeed !== '');
  return revealed.length === 0 ? undefined : revealed[revealed.length - 1].allocationSeed as string;
}

/**
 * Once run, a concealed allocation shows the seed it drew from, and that seed is the one its digest registered: a
 * match is said as a note, a mismatch is an error, since then the draws are not the ones the file committed to.
 */
export async function checkRevealed(model: StudyModel): Promise<{ issues: Issue[]; note?: string }> {
  const issues: Issue[] = [];
  const matched: string[] = [];
  for (const { id, label, digest, element } of concealing(model)) {
    const seed = revealedSeed(element);
    if (seed === undefined) continue;
    if (await seedDigestOf(seed) === digest) matched.push(label);
    else issues.push({ severity: 'error', elementId: id, message: `'${label}' reveals a seed whose digest is not the seedDigest it registered: `
      + 'the seed or the digest was changed after the run, so its draws are not the ones the file committed to' });
  }
  return { issues, note: matched.length === 0 ? undefined : `allocation seed of ${matched.map((label) => `'${label}'`).join(', ')} matches its registered digest` };
}
