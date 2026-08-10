/** mulberry32 -- deterministic PRNG, so gateway draws reproduce across runs given the same `?seed`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class UndeclaredReference extends Error {
  readonly reference: string;

  constructor(reference: string) {
    super(`"${reference}" is not declared by any scope in this run`);
    this.name = 'UndeclaredReference';
    this.reference = reference;
  }
}

export type ConditionResult = {
  value: boolean;
  error?: string;
};

export function evaluateCondition(
  expression: string,
  bindings: Record<string, unknown>,
  language?: string,
): ConditionResult {
  if (language && !['js', 'javascript'].includes(language.toLowerCase())) {
    return {
      value: false,
      error: `a ${language} expression — this runner evaluates JavaScript `
        + '(the reference runner evaluates Python)',
    };
  }
  const scope = new Proxy(bindings, {
    has: () => true,
    get: (target, key) => {
      if (key === Symbol.unscopables) return undefined;
      const name = String(key);
      if (name in target) return (target as Record<string, unknown>)[name];
      throw new UndeclaredReference(name);
    },
  });

  let compiled: (s: unknown) => unknown;
  try {
    compiled = new Function('scope', `with (scope) { return (${expression}); }`) as any;
  } catch (error) {
    return { value: false, error: `cannot parse condition: ${(error as Error).message}` };
  }

  try {
    return { value: Boolean(compiled(scope)) };
  } catch (error) {
    if (error instanceof UndeclaredReference) return { value: false, error: error.message };
    return { value: false, error: (error as Error).message };
  }
}
