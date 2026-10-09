import { expect, test } from '@playwright/test';

import { TrialTally } from '@skills/behaverse/browser/blocks';

/** The browser runner counts a task's trials by the rule the local runner does (local.py `block_counts`, held to the
 * same cases in test_local.py), so a study reads one result whichever runtime plays the task. */
const tallied = (...events: unknown[]) => {
  const tally = new TrialTally();
  for (const event of events) tally.record(event);
  return tally.counts();
};
const ends = (block: number, n: number, answered: boolean, condition: string, correct: boolean | null = null) => ({
  object: { name: 'NB.TrialEnd' }, result: { isAnswered: answered, isCorrect: correct },
  trialContext: { block: { id: block, name: ['Practice', 'Test_A'][block] }, trial: { id: n }, condition },
});
const trial = (n: number, types: string[], rest: Record<string, unknown> = {}) => ({ trialContext: { block: { id: 1 }, trial: { id: n }, types }, ...rest });

test('the build\'s own record of each trial says what each block came to, a burn-in aside', () => {
  expect(tallied(ends(0, 0, false, 'BurnIn'), ends(0, 1, false, 'Match', false), ends(0, 2, false, 'NonMatch', false),
    ends(1, 0, false, 'BurnIn'), ends(1, 1, true, 'Match', true), ends(1, 2, true, 'NonMatch', false),
    ends(1, 3, false, 'NonMatch', false), ends(1, 4, true, 'Match', true))).toEqual([
    { block: 'Practice', trials: 2, answered: 0, unanswered: 2, correct: 0 },
    { block: 'Test_A', trials: 4, answered: 3, unanswered: 1, correct: 2 },
  ]);
});

test('without those records, a trial started or answered counts, a click or a response time answers it, a burn-in does not', () => {
  const shown = [1, 2, 3].map((n) => trial(n, ['TrialStart']));
  const burnIn = trial(1, ['TrialEnd'], { result: { responseTime: null, streamResults: [{ userResponseType: 'BurnInDisabled' }] } });
  expect(tallied(...shown, burnIn, trial(2, ['Click']), trial(3, ['TrialEnd'], { result: { responseTime: null } })))
    .toEqual([{ block: null, trials: 2, answered: 1, unanswered: 1, correct: null }]);
  expect(tallied({ trialContext: { types: ['AppStarted'] } })).toEqual([]);
});
