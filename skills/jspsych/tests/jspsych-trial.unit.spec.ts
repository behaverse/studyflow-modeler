import fs from 'node:fs';
import path from 'node:path';

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
  // [label, Parameters, timeline]: the rows the local runner's timeline_of (skills/jspsych/test_trials.py) is held to too.
  const rows: [string, Record<string, unknown>, unknown][] = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'skills/jspsych/tests/timelines.json'), 'utf8'));
  const variable = (name: string) => ({ timelineVariable: name });
  for (const [label, parameters, timeline] of rows) expect(timelineOf('P', parameters, variable), label).toEqual(timeline);
});
