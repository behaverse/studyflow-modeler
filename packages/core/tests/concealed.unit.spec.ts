import { expect, test } from '@playwright/test';

import { checkConcealed, checkRevealed } from '@core/checks/concealed';
import { protocolDigest } from '@core/document';
import { Walk, concealedSeeds, draw, dryHost, permutedBlock, pick, planOf, seedDigestOf, type Host, type WalkOptions } from '@core/engine';
import { studyModel } from '@tests/schemas';

/** A concealed allocation (`seedDigest` on a random gateway): the gateway draws from a seed of its own, which the file
 * shows only as its digest until a run reveals it. */

const SECRET = '0123456789abcdef0123456789abcdef';

/** Eight subjects through one random gateway, the study seeded with 3; `extra` adds to the gateway's attributes. */
const cohort = (algorithm: string, extra = ''): string => `id: study
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  extensionElements:
    - type: studyflow:Study
      seed: 3
  participants:
    Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 8
      processRef: S
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Allocate:
      type: ExclusiveGateway
      name: Allocation
      extensionElements:
        - type: cognitive:RandomGateway
          algorithm: ${algorithm}
          blockSize: 2${extra}
    A: { type: Task }
    B: { type: Task }
    S9: { type: EndEvent }
    SF0: S0 -> Allocate
    F_A: Allocate -> A
    F_B: Allocate -> B
    SF1: A -> S9
    SF2: B -> S9
`;

/** The arms the eight subjects drew, in participant order. */
async function arms(study: string, options: WalkOptions): Promise<string[]> {
  const plan = planOf(studyModel(study));
  const log: string[] = [];
  const host: Host = { ...dryHost(plan), log: (event, message) => log.push(`${event} ${message.trim()}`) };
  await new Walk(plan, host, options).run();
  return log.flatMap((line) => line.match(/drawn → F_([AB])/)?.[1] ?? []);
}

for (const algorithm of ['simple', 'block']) {
  test(`a concealed allocation draws from its own seed, which a seeded run must be given (${algorithm})`, async () => {
    const study = cohort(algorithm, `\n          seedDigest: "${await seedDigestOf(SECRET)}"`);
    // The arms are the concealed seed's, as the open draw would make them from that seed: the study's seed has no say.
    const expected = Array.from({ length: 8 }, (_, k) => (algorithm === 'block'
      ? permutedBlock(SECRET, 'Allocate@1', Math.floor(k / 2), [1, 1], 2)[k % 2]
      : pick(draw(SECRET, 'Allocate', k + 1, 1), [1, 1]))).map((arm) => 'AB'[arm]);
    expect(await arms(study, { concealed: { Allocate: SECRET } })).toEqual(expected);
    // Without it a seeded run cannot draw, and says how to give it; a simulation, unseeded on purpose, still draws.
    expect(() => new Walk(planOf(studyModel(study)), dryHost(planOf(studyModel(study))), {}))
      .toThrow(/'Allocation' conceals its allocation: .* `--allocation-seed Allocate=<seed>`/);
    expect(await arms(study, { seed: null })).toHaveLength(8);
  });
}

test('a seed given for a concealed allocation is held against its digest before the walk', async () => {
  const plan = planOf(studyModel(cohort('block', `\n          seedDigest: "${await seedDigestOf(SECRET)}"`)));
  await expect(concealedSeeds(plan, { Allocate: SECRET })).resolves.toEqual({ Allocate: SECRET });
  const REFUSED: [label: string, given: Record<string, string>, message: RegExp][] = [
    ['another seed', { Allocate: SECRET.replace('0', '1') }, /is not the one its seedDigest registers/],
    ['a seed short enough to find from its digest', { Allocate: '42' }, /has 2 characters: a concealed seed needs at least 32/],
    ['no seed', {}, /'Allocation' conceals its allocation: .* `--allocation-seed Allocate=<seed>`/],
    ['a seed for a gateway that conceals nothing', { Allocate: SECRET, A: SECRET }, /is not a random gateway that conceals its allocation/],
  ];
  for (const [label, given, message] of REFUSED) await expect(concealedSeeds(plan, given), label).rejects.toThrow(message);
});

test('validate holds a concealed allocation to a digest, to an algorithm a seed can conceal, and to the seed it revealed', async () => {
  const digest = await seedDigestOf(SECRET);
  const record = (seed: string): string => `\n        - type: prov:Activity\n          action: executed\n          what: F_A\n          allocationSeed: "${seed}"`;
  const at = (study: string, extension: string): string => study.replace('          blockSize: 2', `          blockSize: 2${extension}`);
  const revealing = (seed: string): string => cohort('block', `\n          seedDigest: "${digest}"`).replace('      name: Allocation\n      extensionElements:', `      name: Allocation\n      extensionElements:${record(seed)}`);

  const PLANS: [label: string, study: string, message?: RegExp][] = [
    ['a concealed block allocation', cohort('block', `\n          seedDigest: "${digest}"`)],
    ['an open allocation', cohort('simple')],
    ['a digest that is not one', at(cohort('simple'), '\n          seedDigest: "42"'), /has seedDigest: "42", which is not a digest/],
    ['alternation, which no seed conceals', at(cohort('alternation'), `\n          seedDigest: "${digest}"`), /'Allocation' conceals an allocation by alternation/],
  ];
  for (const [label, study, message] of PLANS) {
    const issues = checkConcealed(studyModel(study));
    if (message) expect(issues.map((issue) => issue.message), label).toEqual([expect.stringMatching(message)]);
    else expect(issues, label).toEqual([]);
  }

  // Revealed, the seed is checked against the digest the gateway registered; a run's record is not the protocol, so
  // revealing the seed leaves the protocol's own digest as it was.
  expect(await checkRevealed(studyModel(revealing(SECRET)))).toEqual({ issues: [], note: 'allocation seed of \'Allocation\' matches its registered digest' });
  expect((await checkRevealed(studyModel(revealing(SECRET.replace('0', '1'))))).issues).toEqual([
    expect.objectContaining({ severity: 'error', elementId: 'Allocate', message: expect.stringMatching(/reveals a seed whose digest is not the seedDigest it registered/) }),
  ]);
  expect(await checkRevealed(studyModel(cohort('block', `\n          seedDigest: "${digest}"`)))).toEqual({ issues: [], note: undefined });
  expect(await protocolDigest(studyModel(revealing(SECRET)))).toBe(await protocolDigest(studyModel(cohort('block', `\n          seedDigest: "${digest}"`))));
});
