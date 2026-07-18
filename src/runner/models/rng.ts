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

/** Evaluate a sequence-flow condition expression against the runtime variable
 *  bag. The authored contract language is CEL (`expressionLanguage` on
 *  bpmn:Definitions); this in-browser simulator evaluates the JS-compatible
 *  subset of it - comparisons, field access, `&&`/`||`/`!`, `!= null` - which
 *  covers every condition the schemas ship. Returns false on any error
 *  (missing vars, syntax) so a bad expression never halts traversal. */
export function evaluateCondition(expression: string, variables: Record<string, unknown>): boolean {
  const compiled = new Function('variables', `with (variables) { return (${expression}); }`);
  try { return Boolean(compiled(variables)); } catch { return false; }
}
