/** mulberry32 -- deterministic PRNG. Seeded so gateway draws are reproducible
 *  across runs given the same `?seed`. */
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

/** Reading a name no open scope declares. Distinct from a condition that is
 *  simply false, which is why it is a typed error and not a silent `false`. */
export class UndeclaredReference extends Error {
  /** The identifier the expression tried to read. */
  readonly reference: string;

  constructor(reference: string) {
    super(`"${reference}" is not declared by any scope in this run`);
    this.name = 'UndeclaredReference';
    this.reference = reference;
  }
}

export type ConditionResult = {
  value: boolean;
  /** Set when the expression could not be evaluated. The branch is not taken
   *  either way, but the caller can report the defect instead of guessing. */
  error?: string;
};

/**
 * Evaluate a sequence-flow condition against the run's bindings. The authored
 * contract language is CEL (`expressionLanguage` on bpmn:Definitions); this
 * in-browser simulator evaluates the JS-compatible subset of it - comparisons,
 * field access, `&&`/`||`/`!`, `!= null` - which covers every condition the
 * schemas ship.
 *
 * Every identifier resolves through the bindings: the `has` trap claims all
 * names so `with` routes each lookup into `get`, where a name that no scope
 * declared raises {@link UndeclaredReference} rather than reading through to a
 * global. A declared-but-unwritten name reads as `undefined` and evaluates
 * normally; only an *undeclared* one is a defect.
 */
export function evaluateCondition(
  expression: string,
  bindings: Record<string, unknown>,
): ConditionResult {
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
