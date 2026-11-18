import { expect, test } from '@playwright/test';

import { faceOf, type Face, type FaceInput } from '@modeler/composer/face';

/** Each row: the app's state, then the composer's face; the first rule that applies wins. */
const ROWS: [situation: string, input: FaceInput, face: Face][] = [
  ['a version on disk to review, over everything', { mode: 'review', blank: true, selected: 2 }, 'review'],
  ['a replay, over a blank study and a selection', { mode: 'replay', blank: true, selected: 2 }, 'replay'],
  ['a simulation, over a blank study and a selection', { mode: 'simulation', blank: true, selected: 2 }, 'playback'],
  ['a blank study, over a selection', { mode: 'edit', blank: true, selected: 1 }, 'home'],
  ['something selected', { mode: 'edit', blank: false, selected: 1 }, 'selection'],
  ['nothing else', { mode: 'edit', blank: false, selected: 0 }, 'design'],
];

test('the composer turns to what the app is doing', () => {
  for (const [situation, input, face] of ROWS) expect(faceOf(input), situation).toBe(face);
});
