import { feelHolds } from '@core/expression/feel';

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

/**
 * A random gateway's draw on one visit, in [0, 1): mulberry32 seeded with the FNV-1a hash of `seed:gateway:visit`.
 * Each draw depends on nothing else, so a seed picks the same branches in any order of the walk, and in both
 * runtimes: skills/local/run.py `draw` is the same function.
 */
export function draw(seed: number, gatewayId: string, visit: number): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(`${seed}:${gatewayId}:${visit}`)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return mulberry32(hash)();
}

export type ConditionResult = {
  value: boolean;
  error?: string;
};

/** A flow's condition, in FEEL as every Studyflow expression is (packages/core/src/expression/feel.ts): it holds
 * only when it evaluates to `true`. BPMN's per-expression `language` may say FEEL and nothing else. */
export function evaluateCondition(
  expression: string,
  bindings: Record<string, unknown>,
  language?: string,
): ConditionResult {
  if (language && !language.toLowerCase().includes('feel')) {
    return { value: false, error: `a ${language} expression — every Studyflow expression is FEEL` };
  }
  const { value, error } = feelHolds(expression, bindings);
  return { value: value === true, error };
}
