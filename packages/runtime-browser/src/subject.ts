/**
 * Who is at the page. A session is one participant, one instance of its pool, and a random gateway draws for that
 * instance from the study's seed (`packages/core/src/engine/allocation.ts`). `?participant=k` says which instance
 * the session is, so participant k draws what the k-th instance of a local run draws; without it, every session is
 * participant 1. The subject id names the run in the record.
 */

/** The subject id a run was launched with, under any of the spellings in use. */
export function readSubjectId(parameters: Record<string, string>): string | undefined {
  for (const key of ['subject_id', 'subjectId', 'participant_id', 'participantId']) {
    const value = parameters[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** Which instance of its pool the session is, 1-based: `?participant=k`, when k is a whole number from 1. */
export function readParticipant(parameters: Record<string, string>): number | undefined {
  const text = parameters.participant?.trim();
  return text && /^[1-9]\d*$/.test(text) ? Number(text) : undefined;
}
