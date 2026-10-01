import { expect, test } from '@playwright/test';

import { timelineOf, trialOf } from '@skills/jspsych/browser/trial';

/** What a `jspsych://` step hands jsPsych in the browser runtime: the builds it loads, and the timeline it runs. */

test('a reference names the plugin, and its version jsPsych\'s, which picks the plugin\'s release line', () => {
  expect(trialOf('jspsych://html-keyboard-response@8')).toEqual({
    plugin: 'html-keyboard-response',
    version: '8',
    core: { script: 'https://unpkg.com/jspsych@8/dist/index.browser.min.js', css: 'https://unpkg.com/jspsych@8/css/jspsych.css' },
    script: 'https://unpkg.com/@jspsych/plugin-html-keyboard-response@2/dist/index.browser.min.js',
    global: 'jsPsychHtmlKeyboardResponse',
  });
  const CASES: [label: string, input: string, error: RegExp][] = [
    ['no version', 'jspsych://html-keyboard-response', /names no jsPsych version/],
    ['a jsPsych this runtime does not play', 'jspsych://html-keyboard-response@6.3', /jsPsych 6.3 is not one/],
    ['another scheme', 'python://m.f', /no jspsych:\/\/ reference/],
  ];
  for (const [label, input, error] of CASES) expect((trialOf(input) as { error: string }).error, label).toMatch(error);
});

test('the Parameters are the plugin\'s, and timeline variables a timeline over them', () => {
  const variable = (name: string) => `<${name}>`;
  expect(timelineOf('P', { stimulus: '+', choices: 'NO_KEYS' }, variable)).toEqual({ type: 'P', stimulus: '+', choices: 'NO_KEYS' });
  expect(timelineOf('P', {
    timeline_variables: [{ stimulus: '<<<<<', correct_response: 'f' }],
    randomize_order: true,
    repetitions: 2,
    choices: ['f', 'j'],
    correct_response: 'j',
  }, variable)).toEqual({
    timeline_variables: [{ stimulus: '<<<<<', correct_response: 'f' }],
    randomize_order: true,
    repetitions: 2,
    timeline: [{ type: 'P', choices: ['f', 'j'], correct_response: 'j', stimulus: '<stimulus>' }],
  });
});
