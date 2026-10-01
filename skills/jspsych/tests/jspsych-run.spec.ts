import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { studyToXml } from '@core/document';
import { runStudyflow } from '@tests/utils';

/** A `jspsych://` step in the browser runtime: the plugin plays with the Parameters wired into it, and its data are the step's result. */

const STUDY = `id: jspsych_run
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  name: One jsPsych trial
  properties:
    P_Trials:
      name: trials
  flowElements:
    Start:
      type: StartEvent
      name: Welcome
    Settings:
      type: DataObjectReference
      extensionElements:
        - type: studyflow:Parameters
          values:
            stimulus: <p>Press F</p>
            choices: [f]
    Trial:
      type: UserTask
      name: Press F
      implementation: jspsych://html-keyboard-response@8
      dataInputAssociations:
        In_Settings: { sourceRef: [Settings] }
      dataOutputAssociations:
        Out_Trials: { targetRef: P_Trials }
    Done:
      type: EndEvent
    F1: Start -> Trial
    F2: Trial -> Done
`;

/** unpkg's files, served from node_modules: the test reads no network. */
const MODULES = path.join(process.cwd(), 'node_modules');
const LOCAL: [RegExp, string][] = [
  [/\/jspsych@8\/dist\/index\.browser\.min\.js$/, 'jspsych/dist/index.browser.min.js'],
  [/\/jspsych@8\/css\/jspsych\.css$/, 'jspsych/css/jspsych.css'],
  [/\/@jspsych\/plugin-html-keyboard-response@2\/dist\/index\.browser\.min\.js$/, '@jspsych/plugin-html-keyboard-response/dist/index.browser.min.js'],
];

test('a jspsych:// step plays its plugin with the Parameters wired into it, and its trials\' data are its result', async ({ page }) => {
  await page.route('https://unpkg.com/**', (route) => {
    const file = LOCAL.find(([pattern]) => pattern.test(route.request().url()))?.[1];
    return file ? route.fulfill({ path: path.join(MODULES, file) }) : route.abort();
  });
  const { studyModel } = await import('@tests/schemas');
  await runStudyflow(page, 'jspsych-run', await studyToXml(studyModel(STUDY)));

  await page.getByRole('button', { name: /begin/i }).click();
  await expect(page.getByText('Press F', { exact: true })).toBeVisible();
  await page.keyboard.press('f');
  await expect(page.getByRole('heading', { name: /complete/i })).toBeVisible();

  await page.getByRole('button', { name: /logs/i }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /download the run's record/i }).click();
  const events: { event: string; name?: string; value?: { response: string; stimulus: string }[] }[] = fs.readFileSync(await (await download).path(), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const [row] = events.find((event) => event.event === 'wrote' && event.name === 'trials')?.value ?? [];
  expect(row).toMatchObject({ response: 'f', stimulus: '<p>Press F</p>' });
});
