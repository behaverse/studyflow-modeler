import { expect, test } from '@tests/e2e';

import { runStudyflow } from '@tests/utils';

/** The cognitive skill's screens in the browser runtime (browser/). */

const NO_UNITY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" id="runner-stages-no-unity" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:process id="Study_1" isExecutable="false">
    <bpmn2:extensionElements><studyflow:study /></bpmn2:extensionElements>
    <bpmn2:startEvent id="StartEvent_1" name="Welcome">
      <bpmn2:outgoing>F1</bpmn2:outgoing>
    </bpmn2:startEvent>
    <bpmn2:task id="Instr_1" name="Instructions">
      <bpmn2:extensionElements><cognitive:instruction content="Read this carefully." /></bpmn2:extensionElements>
      <bpmn2:incoming>F1</bpmn2:incoming>
      <bpmn2:outgoing>F2</bpmn2:outgoing>
    </bpmn2:task>
    <bpmn2:task id="Quest_1" name="PHQ-9">
      <bpmn2:extensionElements><cognitive:questionnaire instrument="phq-9" /></bpmn2:extensionElements>
      <bpmn2:incoming>F2</bpmn2:incoming>
      <bpmn2:outgoing>F3</bpmn2:outgoing>
    </bpmn2:task>
    <bpmn2:endEvent id="EndEvent_1">
      <bpmn2:incoming>F3</bpmn2:incoming>
    </bpmn2:endEvent>
    <bpmn2:sequenceFlow id="F1" sourceRef="StartEvent_1" targetRef="Instr_1" />
    <bpmn2:sequenceFlow id="F2" sourceRef="Instr_1" targetRef="Quest_1" />
    <bpmn2:sequenceFlow id="F3" sourceRef="Quest_1" targetRef="EndEvent_1" />
  </bpmn2:process>
</bpmn2:definitions>`;

test('an instruction and a questionnaire are screens of their own, and a study with no Behaverse task fetches no Unity build', async ({ page }) => {
  let manifestFetched = false;
  page.on('request', (req) => {
    if (req.url().includes('/assessment-unity/StreamingAssets/Studyflow/manifest.json')) {
      manifestFetched = true;
    }
  });

  await runStudyflow(page, 'runner-stages-no-unity', NO_UNITY_XML);

  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await page.getByRole('button', { name: /begin/i }).click();

  await expect(page.getByRole('heading', { name: 'Instructions' })).toBeVisible();
  await expect(page.getByText('Read this carefully.')).toBeVisible();
  await page.getByRole('button', { name: /continue/i }).click();

  await expect(page.getByRole('heading', { name: /PHQ-9/ })).toBeVisible();
  const submit = page.getByRole('button', { name: /submit/i });
  await expect(submit).toBeDisabled();
  for (let i = 1; i <= 9; i += 1) {
    // The radios are sr-only (styling lives on the wrapping <label>), so .check() needs force to reach them.
    await page.locator(`input[name="phq9_${i}"][value="1"]`).check({ force: true });
  }
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByRole('heading', { name: /complete/i })).toBeVisible();
  expect(manifestFetched).toBe(false);
});
