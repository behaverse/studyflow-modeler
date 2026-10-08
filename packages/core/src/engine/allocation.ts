import type { Plan, PlanElement } from '@core/engine/plan';

/** mulberry32, a deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number in [0, 1) that `key` alone decides: mulberry32 seeded with the FNV-1a hash of the key. */
function uniform(key: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(key)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return mulberry32(hash)();
}

/**
 * A random gateway's draw, in [0, 1), for one participant's visit: `uniform("seed:gateway:participant:visit")`.
 * Each draw depends on nothing else, so a participant draws the same whatever the others do, in any runtime and on
 * any re-run.
 */
export function draw(seed: number | string, gatewayId: string, participant: number, visit: number): number {
  return uniform(`${seed}:${gatewayId}:${participant}:${visit}`);
}

/** The arm a draw `u` in [0, 1) takes: over arms of equal weight `floor(u * n)`, else the first arm whose cumulative
 * weight passes `u` times the total. */
export function pick(u: number, weights: number[]): number {
  if (new Set(weights).size === 1) return Math.floor(u * weights.length);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let reached = 0;
  for (let arm = 0; arm < weights.length; arm += 1) {
    reached += weights[arm];
    if (reached > u * total) return arm;
  }
  return weights.length - 1;
}

/** Block `block` (0-based) of a block-randomized sequence: `size` arms, each as often as its share of the ratio,
 * shuffled by Fisher-Yates on `uniform("seed:sequence:block<b>:i")`, or on `Math.random()` unseeded. */
export function permutedBlock(seed: number | string | undefined, sequence: string, block: number, weights: number[], size: number): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const arms = weights.flatMap((weight, arm) => Array.from({ length: Math.floor(size / total) * weight }, () => arm));
  for (let i = arms.length - 1; i > 0; i -= 1) {
    const u = seed === undefined ? Math.random() : uniform(`${seed}:${sequence}:block${block}:${i}`);
    const j = Math.floor(u * (i + 1));
    [arms[i], arms[j]] = [arms[j], arms[i]];
  }
  return arms;
}

/** The arm the n-th participant (1-based) takes under alternation: the arms in turn, each for as many participants
 * running as its share of the ratio (2:1 deals A, A, B, A, A, B, …). */
export function alternated(n: number, weights: number[]): number {
  const turn = weights.flatMap((weight, arm) => Array.from({ length: weight }, () => arm));
  return turn[(n - 1) % turn.length];
}

/** How often minimization takes an arm of least imbalance; otherwise it takes one of the other arms. */
export const MINIMIZATION_PROBABILITY = 0.8;

/**
 * Pocock–Simon minimization by the range method. `counts[f][a]` is how many participants before this one, at this
 * one's level of factor f, took arm a. Taking arm a would leave on each factor a range, its largest count less its
 * smallest with a's count one higher; a's imbalance is the sum of those ranges. A draw `u` below
 * {@link MINIMIZATION_PROBABILITY} takes one of the arms of least imbalance, else one of the others, each equally
 * likely; when every arm leaves the same imbalance, `u` picks among them all.
 */
export function minimized(counts: number[][], u: number): number {
  const arms = counts[0].map((_count, arm) => arm);
  const imbalance = arms.map((arm) => counts.reduce((sum, row) => {
    const after = row.map((count, other) => count + (other === arm ? 1 : 0));
    return sum + Math.max(...after) - Math.min(...after);
  }, 0));
  const lowest = Math.min(...imbalance);
  const least = arms.filter((arm) => imbalance[arm] === lowest);
  const others = arms.filter((arm) => !least.includes(arm));
  if (others.length === 0) return least[Math.floor(u * least.length)];
  const p = MINIMIZATION_PROBABILITY;
  return u < p ? least[Math.floor((u / p) * least.length)] : others[Math.floor(((u - p) / (1 - p)) * others.length)];
}

export type Allocation = {
  algorithm: 'simple' | 'block' | 'alternation' | 'minimization';
  /** The arms' weights, in branch order. */
  weights: number[];
  size: number;
  /** The values `stratifyBy` names, which each participant has on reaching the gateway: block and alternation deal
   * within each combination of their levels, minimization balances the arms on each. */
  factors: string[];
  /** A concealed allocation's `seedDigest`: the gateway draws from a seed of its own, which the file shows only as this. */
  seedDigest?: string;
};

const ALGORITHMS = ['simple', 'block', 'alternation', 'minimization'] as const;

/**
 * A random gateway's allocation as the walk applies it: the algorithm, the arms' weights in branch order
 * (`allocationRatio`, equal without one), the block size, and the factors to stratify or minimize on (`stratifyBy`,
 * names separated by commas). What the walk cannot apply as written is an error before the walk: a ratio that does not
 * give each branch a positive whole number, a block that cannot hold the arms in that ratio, an algorithm it does not
 * know, strata under simple randomization (which draws each participant alone, so strata change nothing), minimization
 * without factors, or at a ratio other than equal.
 */
export function allocationOf(gateway: PlanElement, arms: number): Allocation {
  const ext = gateway.extensions[0]?.attributes ?? {};
  const read = (name: string): string | undefined => (typeof ext[name] === 'string' && ext[name] ? ext[name] as string : undefined);
  const label = gateway.name || gateway.id;
  const ratio = read('allocationRatio') ?? Array.from({ length: arms }, () => '1').join(':');
  const parts = ratio.split(':').map((part) => part.trim());
  if (parts.length !== arms || !parts.every((part) => /^\d+$/.test(part) && Number(part) > 0)) {
    throw new Error(`'${label}' has allocationRatio '${ratio}': it wants one positive whole number per outgoing branch, `
      + `in branch order, and the gateway has ${arms}.`);
  }
  const weights = parts.map(Number);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const algorithm = (read('algorithm') ?? 'simple') as Allocation['algorithm'];
  if (!ALGORITHMS.includes(algorithm)) {
    throw new Error(`'${label}' has algorithm '${algorithm}', which the walk does not know: ${ALGORITHMS.join(', ')}.`);
  }
  const size = Number(read('blockSize') ?? 4);
  if (algorithm === 'block' && (size < 1 || size % total)) {
    throw new Error(`'${label}' allocates in blocks of ${size}, which cannot hold its ${arms} arms in the ratio ${ratio}: `
      + `make blockSize a multiple of ${total}.`);
  }
  const factors = (read('stratifyBy') ?? '').split(',').map((factor) => factor.trim()).filter(Boolean);
  if (algorithm === 'simple' && factors.length > 0) {
    throw new Error(`'${label}' stratifies by ${factors.join(', ')} under simple randomization, which draws each `
      + 'participant alone, so strata change nothing: allocate in blocks (algorithm: block), by minimization, or drop stratifyBy.');
  }
  if (algorithm === 'minimization' && factors.length === 0) {
    throw new Error(`'${label}' allocates by minimization, which balances the arms on the factors stratifyBy names, and it names none.`);
  }
  if (algorithm === 'minimization' && new Set(weights).size > 1) {
    throw new Error(`'${label}' allocates by minimization in the ratio ${ratio}: minimization balances equal arms, so `
      + 'drop allocationRatio, or allocate in stratified blocks (algorithm: block), which keep any ratio.');
  }
  return { algorithm, weights, size, factors, seedDigest: read('seedDigest') };
}

/** Why a walk of one participant, a browser session, cannot allocate by what the participants before it took. */
export function withoutCohort(gateway: PlanElement, allocation: Allocation): string {
  const factors = allocation.factors.map((factor) => `'${factor}'`).join(', ');
  const how = allocation.algorithm === 'minimization' ? `minimizes imbalance on ${factors}` : `deals its arms within each stratum of ${factors}`;
  return `'${gateway.name || gateway.id}' ${how}, so a participant's arm depends on the participants before it, which a `
    + 'session of one participant does not know. Run the cohort in the local runtime, which walks every participant in '
    + 'turn, or allocate in blocks or by alternation without stratifyBy, which a session deals by its participant number.';
}

/** The fewest characters a concealed seed may have: 32 hex digits are 128 bits, too many seeds to try one by one
 * against the digest the file shows. */
export const CONCEALED_SEED_LENGTH = 32;

/** A concealed seed's digest, `sha256:<hex>` over its text, as a gateway's `seedDigest` registers it. */
export async function seedDigestOf(seed: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
  return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Why a run that was not given a concealed allocation's seed cannot draw it, and how a run is given it. */
export function withoutConcealedSeed(gateway: PlanElement, digest: string): string {
  return `'${gateway.name || gateway.id}' conceals its allocation: it draws from a seed the file shows only as `
    + `${digest.slice(0, 19)}…, and this run was not given it. The local runtime takes it as `
    + `\`--allocation-seed ${gateway.id}=<seed>\`; a browser session is never given it, since the link would carry it `
    + 'to whoever hands the link out.';
}

/**
 * The seeds a run was given for the gateways that conceal their allocation, by gateway id, each held against the
 * `seedDigest` its gateway registers. A concealing gateway without one, a seed for a gateway that conceals nothing,
 * one shorter than {@link CONCEALED_SEED_LENGTH}, or one whose digest is not the registered one is an error before
 * the walk.
 */
export async function concealedSeeds(plan: Plan, given: Record<string, string>): Promise<Record<string, string>> {
  for (const gateway of Object.values(plan.elements)) {
    const digest = gateway.branching === 'random' ? gateway.extensions[0]?.attributes.seedDigest : undefined;
    if (typeof digest === 'string' && digest && given[gateway.id] === undefined) throw new Error(withoutConcealedSeed(gateway, digest));
  }
  for (const [id, seed] of Object.entries(given)) {
    const gateway = plan.elements[id];
    const label = gateway ? gateway.name || id : id;
    const registered = gateway?.branching === 'random' ? gateway.extensions[0]?.attributes.seedDigest : undefined;
    if (typeof registered !== 'string' || !registered) {
      throw new Error(`'${label}' is given a seed, but it is not a random gateway that conceals its allocation (no seedDigest).`);
    }
    if (seed.length < CONCEALED_SEED_LENGTH) {
      throw new Error(`The seed given for '${label}' has ${seed.length} characters: a concealed seed needs at least `
        + `${CONCEALED_SEED_LENGTH} (\`openssl rand -hex 16\`), or anyone could find it by trying seeds against its digest.`);
    }
    const digest = await seedDigestOf(seed);
    if (digest !== registered) {
      throw new Error(`The seed given for '${label}' is not the one its seedDigest registers: its digest is `
        + `${digest.slice(0, 19)}…, the file's ${registered.slice(0, 19)}….`);
    }
  }
  return given;
}
