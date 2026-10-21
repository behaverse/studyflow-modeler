import { expect, test } from '@playwright/test';

import { VirtualClock } from '@runtime-local/clock';

/** The virtual clock a local run's timers wait on under `--clock virtual` (src/clock.ts). How a run uses it is pinned
 * in cli-run.unit.spec.ts. */

const DAY = 86_400_000;
const turn = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

test('when nothing else can happen, the clock jumps to the earliest timer, and timers due at one moment run out in the order they were set', async () => {
  const jumps: [string, number][] = [];
  const clock = new VirtualClock((at, by) => jumps.push([at, by]));
  const started = clock.now();
  const rang: string[] = [];
  const never = new AbortController();
  const late = clock.wait(7 * DAY, never.signal, 'Late').then(() => rang.push('Late'));
  const first = clock.wait(DAY, never.signal, 'First').then(() => rang.push('First'));
  const twin = clock.wait(DAY, never.signal, 'Twin').then(() => rang.push('Twin'));
  await Promise.all([first, twin]);
  expect(rang).toEqual(['First', 'Twin']);
  await late;
  expect(rang).toEqual(['First', 'Twin', 'Late']);
  expect(jumps.map(([at]) => at)).toEqual(['First', 'Late']);
  // Virtual time is where the last timer ran out, a week on, and the machine took no week.
  expect(clock.now() - started).toBeGreaterThanOrEqual(7 * DAY);
  expect(clock.now() - started).toBeLessThan(7 * DAY + 5000);
  clock.stop();
});

test('a hand-off in progress keeps the clock from jumping, so a timer runs out ahead of an answer only when none is on its way', async () => {
  const clock = new VirtualClock();
  const stop = new AbortController();
  let rang = false;
  void clock.wait(7 * DAY, stop.signal, 'Late').then(() => { rang = true; });
  // An answer that takes a while: the clock waits for it, and the timer it beats is stopped.
  const answer = clock.during(async () => {
    for (let i = 0; i < 20; i += 1) await turn();
    return 'READY';
  });
  expect(await answer).toBe('READY');
  stop.abort();
  for (let i = 0; i < 10; i += 1) await turn();
  expect(rang).toBe(false);
  // A timer stopped before it ran out never does, and one set on a stopped clock never runs out.
  clock.stop();
  let after = false;
  void clock.wait(0, new AbortController().signal, 'After').then(() => { after = true; });
  for (let i = 0; i < 10; i += 1) await turn();
  expect(after).toBe(false);
});

test('virtual time passes as the machine\'s does: a short timer runs out on time during a hand-off', async () => {
  const clock = new VirtualClock();
  const begun = Date.now();
  const ran = await clock.during(() => clock.wait(50, new AbortController().signal, 'Short').then(() => Date.now() - begun));
  expect(ran).toBeGreaterThanOrEqual(45);
  clock.stop();
});
