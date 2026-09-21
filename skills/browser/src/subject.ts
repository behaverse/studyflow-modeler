/**
 * Deterministic allocation from a subject id.
 *
 * The random gateway's draw is already reproducible given the run's seed
 * (`branching.ts`: mulberry32 over FNV-1a of `seed:gateway:visit`), so a study
 * that wants the same participant to land in the same arm every time does not
 * need an allocator that remembers cohorts -- it needs the seed to be a
 * function of who is running. `?subject_id=P042` supplies one: the same id
 * always yields the same seed, hence the same branch at every gateway, in this
 * runner and in the Python one.
 *
 * An explicit `?seed=` still wins, so a fixed seed can reproduce a whole cohort.
 */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function seedFromSubject(subjectId: string): number {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(subjectId)) {
    hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
  }
  // Keep it inside the safe-integer range a `seed` attribute can carry as text.
  return hash;
}

/** The subject id a run was launched with, under any of the spellings in use. */
export function readSubjectId(parameters: Record<string, string>): string | undefined {
  for (const key of ['subject_id', 'subjectId', 'participant_id', 'participantId']) {
    const value = parameters[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * The parameters a run should use: unchanged when a seed was given, otherwise
 * carrying a seed derived from the subject id so allocation is reproducible.
 */
export function withSubjectSeed(parameters: Record<string, string>): Record<string, string> {
  if (parameters.seed) return parameters;
  const subject = readSubjectId(parameters);
  if (!subject) return parameters;
  return { ...parameters, seed: String(seedFromSubject(subject)) };
}
