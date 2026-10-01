import { expect, test } from '@playwright/test';

import { viewOf } from '@runner/nodes/message/view';

/** What a person is shown of a message, and answers with. */
test('a message shows its text, the fields of what it carries, and the options to answer by', () => {
  // A step's data inputs, by source id: a trial, the instruction, and a prompt with no value this run.
  expect(viewOf({
    Trial: { Stimulus: 'a red square', Before: [3], ResponseOptions: ['left', 'right'] },
    Instruction: 'Answer as fast as you can.',
    Prompt: null,
  })).toEqual({ texts: ['Answer as fast as you can.'], fields: [['Stimulus', 'a red square'], ['Before', '[3]']], options: ['left', 'right'] });
  // One value sent whole, and nothing to choose from: the person writes the answer.
  expect(viewOf('Ready?')).toEqual({ texts: ['Ready?'], fields: [], options: [] });
  expect(viewOf({ options: ['yes', 'no'] }).options).toEqual(['yes', 'no']);
});
