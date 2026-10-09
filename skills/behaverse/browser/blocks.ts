/**
 * What a played task's trials came to, block by block, as the build's own records say: the `blocks` of a Behaverse
 * task's result (`behaverse:TaskResult`, `BlockCounts` in behaverse.moddle.yaml), counted by the rule the local runner
 * counts them by (`block_counts` in local.py), so a study reads the same result whichever runtime plays the task.
 */

/** One block's trials: how many the build presented, recorded a valid response for, recorded none for, and scored
 * correct (null when its records say nothing of correctness). */
export type BlockCounts = { block: string | null; trials: number; answered: number; unanswered: number; correct: number | null };

type Ended = { answered: boolean; condition: string; correct: boolean | null };

type BdmEvent = {
  object?: { name?: string };
  trialContext?: { block?: { id?: unknown; name?: unknown }; trial?: { id?: unknown }; types?: string[]; condition?: unknown };
  result?: { isAnswered?: unknown; isCorrect?: unknown; responseTime?: unknown; streamResults?: { userResponseType?: string }[] };
};

/** The task's trials as the build's records describe them, one record at a time (`tally` in local.py). */
export class TrialTally {
  private readonly shown = new Set<string>();
  private readonly answered = new Set<string>();
  private readonly unanswerable = new Set<string>();
  private readonly blockOf = new Map<string, string>();
  private readonly ended = new Map<string, Ended>();

  /** One event: `TrialStart` shows a trial, a `Click` or a `TrialEnd` with a `responseTime` answers it, a `TrialEnd`
   * whose every stream says `BurnInDisabled` took none, and a `<TASK>.TrialEnd` with `result.isAnswered` is the build's
   * one record of the trial (whether answered, whether right, its condition). */
  record(event: unknown): void {
    const { object, trialContext: context = {}, result = {} } = (event ?? {}) as BdmEvent;
    const kinds = context.types ?? [];
    const trialId = context.trial?.id;
    if (trialId === undefined || trialId === null) return;
    const trial = `${String(context.block?.id)}:${String(trialId)}`;
    if (context.block?.name) this.blockOf.set(trial, String(context.block.name));
    if (String(object?.name ?? '').endsWith('.TrialEnd') && typeof result.isAnswered === 'boolean') {
      this.ended.set(trial, { answered: result.isAnswered, condition: String(context.condition ?? ''),
        correct: typeof result.isCorrect === 'boolean' ? result.isCorrect : null });
    }
    if (kinds.includes('TrialStart')) this.shown.add(trial);
    if (kinds.includes('Click') || (kinds.includes('TrialEnd') && result.responseTime !== undefined && result.responseTime !== null)) this.answered.add(trial);
    const streams = result.streamResults ?? [];
    if (kinds.includes('TrialEnd') && streams.length > 0 && streams.every((stream) => stream?.userResponseType === 'BurnInDisabled')) this.unanswerable.add(trial);
  }

  /** The counts, block by block in the order played; a burn-in trial, presented only so the responder sees every
   * digit, is never counted. */
  counts(): BlockCounts[] {
    const counted = new Map<string, { answered: boolean; correct: boolean | null }>();
    if (this.ended.size > 0) {
      for (const [trial, { answered, condition, correct }] of this.ended) if (condition !== 'BurnIn') counted.set(trial, { answered, correct });
    } else {
      for (const trial of [...new Set([...this.shown, ...this.answered])].sort()) {
        if (!this.unanswerable.has(trial)) counted.set(trial, { answered: this.answered.has(trial), correct: null });
      }
    }
    const order = [...new Set(this.blockOf.values())];
    const rank = (trial: string): number => {
      const at = order.indexOf(this.blockOf.get(trial) ?? '');
      return at < 0 ? order.length : at;
    };
    const blocks = new Map<string | null, BlockCounts>();
    for (const trial of [...counted.keys()].sort((a, b) => rank(a) - rank(b))) {
      const { answered, correct } = counted.get(trial)!;
      const name = this.blockOf.get(trial) ?? null;
      const block = blocks.get(name) ?? { block: name, trials: 0, answered: 0, unanswered: 0, correct: 0 };
      blocks.set(name, block);
      block.trials += 1;
      if (answered) block.answered += 1;
      else block.unanswered += 1;
      if (block.correct !== null) block.correct = correct === null ? null : block.correct + (correct ? 1 : 0);
    }
    return [...blocks.values()];
  }
}
