import { expect, test, type Page } from '@playwright/test';

/**
 * Stage a studyflow XML in localStorage under the given key (mimicking the
 * modeler's "Run" button), then navigate to the runtime.
 *
 * `addInitScript` runs before any other JS on the page, so localStorage is
 * already populated by the time Executor mounts and reads it.
 * (The modeler's Run button stages XML on a different page than the runtime
 * loads from, but in tests we don't have that intermediate context, so we
 * inject directly.)
 */
async function runStudyflow(page: Page, key: string, xml: string): Promise<void> {
  await page.addInitScript(
    ({ k, x }) => {
      try {
        localStorage.setItem(k, x);
      } catch {
        /* ignore */
      }
    },
    { k: key, x: xml },
  );
  await page.goto(`/run.html?diagram_id=${key}&seed=42`);
}

const NO_UNITY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" id="runner-stages-no-unity" targetNamespace="http://bpmn.io/schema/bpmn">
  <studyflow:study id="Study_1" isExecutable="false">
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
  </studyflow:study>
</bpmn2:definitions>`;

const CONSENT_DECLINE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" id="runner-stages-consent" targetNamespace="http://bpmn.io/schema/bpmn">
  <studyflow:study id="Study_1" isExecutable="false">
    <bpmn2:startEvent id="StartEvent_1" name="Consent" studyflow:consentFormUri="/consent.txt">
      <bpmn2:outgoing>F1</bpmn2:outgoing>
    </bpmn2:startEvent>
    <bpmn2:task id="Instr_1" name="Should not appear">
      <bpmn2:extensionElements><cognitive:instruction content="never" /></bpmn2:extensionElements>
      <bpmn2:incoming>F1</bpmn2:incoming>
      <bpmn2:outgoing>F2</bpmn2:outgoing>
    </bpmn2:task>
    <bpmn2:endEvent id="EndEvent_1">
      <bpmn2:incoming>F2</bpmn2:incoming>
    </bpmn2:endEvent>
    <bpmn2:sequenceFlow id="F1" sourceRef="StartEvent_1" targetRef="Instr_1" />
    <bpmn2:sequenceFlow id="F2" sourceRef="Instr_1" targetRef="EndEvent_1" />
  </studyflow:study>
</bpmn2:definitions>`;

const UNTYPED_TASK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" id="runner-stages-untyped" targetNamespace="http://bpmn.io/schema/bpmn">
  <studyflow:study id="Study_1" isExecutable="false">
    <bpmn2:startEvent id="StartEvent_1">
      <bpmn2:outgoing>F1</bpmn2:outgoing>
    </bpmn2:startEvent>
    <bpmn2:task id="Untyped_1" name="Plain task">
      <bpmn2:incoming>F1</bpmn2:incoming>
      <bpmn2:outgoing>F2</bpmn2:outgoing>
    </bpmn2:task>
    <bpmn2:endEvent id="EndEvent_1">
      <bpmn2:incoming>F2</bpmn2:incoming>
    </bpmn2:endEvent>
    <bpmn2:sequenceFlow id="F1" sourceRef="StartEvent_1" targetRef="Untyped_1" />
    <bpmn2:sequenceFlow id="F2" sourceRef="Untyped_1" targetRef="EndEvent_1" />
  </studyflow:study>
</bpmn2:definitions>`;

const BOUND_TASK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="runner-stages-bound" targetNamespace="http://bpmn.io/schema/bpmn">
  <studyflow:study id="Study_1" isExecutable="false">
    <bpmn2:startEvent id="StartEvent_1">
      <bpmn2:outgoing>F1</bpmn2:outgoing>
    </bpmn2:startEvent>
    <bpmn2:task id="Bound_1" name="Median RT" studyflow:uses="python://pkg_for_st.do_map@1.2">
      <studyflow:with>column: rt
fn: median</studyflow:with>
      <bpmn2:incoming>F1</bpmn2:incoming>
      <bpmn2:outgoing>F2</bpmn2:outgoing>
    </bpmn2:task>
    <bpmn2:endEvent id="EndEvent_1">
      <bpmn2:incoming>F2</bpmn2:incoming>
    </bpmn2:endEvent>
    <bpmn2:sequenceFlow id="F1" sourceRef="StartEvent_1" targetRef="Bound_1" />
    <bpmn2:sequenceFlow id="F2" sourceRef="Bound_1" targetRef="EndEvent_1" />
  </studyflow:study>
</bpmn2:definitions>`;

const BAD_BINDING_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="runner-stages-badbinding" targetNamespace="http://bpmn.io/schema/bpmn">
  <studyflow:study id="Study_1" isExecutable="false">
    <bpmn2:startEvent id="StartEvent_1">
      <bpmn2:outgoing>F1</bpmn2:outgoing>
    </bpmn2:startEvent>
    <bpmn2:task id="Bad_1" name="Broken binding" studyflow:uses="python:/oops">
      <bpmn2:incoming>F1</bpmn2:incoming>
      <bpmn2:outgoing>F2</bpmn2:outgoing>
    </bpmn2:task>
    <bpmn2:endEvent id="EndEvent_1">
      <bpmn2:incoming>F2</bpmn2:incoming>
    </bpmn2:endEvent>
    <bpmn2:sequenceFlow id="F1" sourceRef="StartEvent_1" targetRef="Bad_1" />
    <bpmn2:sequenceFlow id="F2" sourceRef="Bad_1" targetRef="EndEvent_1" />
  </studyflow:study>
</bpmn2:definitions>`;

test.describe('Studyflow runtime nodes', () => {
  test('no-Unity flow advances through start, instruction, questionnaire, end', async ({ page }) => {
    // Track whether the runtime attempted to fetch the Unity manifest. The
    // refactor's whole point is that diagrams without behaverse tasks must
    // not pay the manifest cost.
    let manifestFetched = false;
    page.on('request', (req) => {
      if (req.url().includes('/assessment-unity/StreamingAssets/Studyflow/manifest.json')) {
        manifestFetched = true;
      }
    });

    await runStudyflow(page, 'runner-stages-no-unity', NO_UNITY_XML);

    // Start stage
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    await page.getByRole('button', { name: 'Begin' }).click();

    // Instruction stage
    await expect(page.getByRole('heading', { name: 'Instructions' })).toBeVisible();
    await expect(page.getByText('Read this carefully.')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Questionnaire stage - PHQ-9
    await expect(
      page.getByRole('heading', { name: 'Patient Health Questionnaire-9 (PHQ-9)' }),
    ).toBeVisible();
    // Submit is disabled until every item is answered
    const submit = page.getByRole('button', { name: 'Submit' });
    await expect(submit).toBeDisabled();
    for (let i = 1; i <= 9; i += 1) {
      // The radio inputs are sr-only (visual styling lives on the wrapping
      // <label>), so a normal .check() can't reach them - use the force flag
      // to dispatch the click directly on the input.
      await page.locator(`input[name="phq9_${i}"][value="1"]`).check({ force: true });
    }
    await expect(submit).toBeEnabled();
    await submit.click();

    // End stage - phase = done, no Unity manifest fetch
    await expect(page.getByRole('heading', { name: 'Study complete' })).toBeVisible();
    expect(manifestFetched).toBe(false);
  });

  test('declined consent aborts the run before instruction', async ({ page }) => {
    await page.route('**/consent.txt', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'You agree to participate.' }),
    );
    await runStudyflow(page, 'runner-stages-consent', CONSENT_DECLINE_XML);

    await expect(page.getByRole('heading', { name: 'Consent' })).toBeVisible();
    await expect(page.getByText('Informed consent')).toBeVisible();

    await page.getByRole('button', { name: 'Decline' }).click();

    // Run should never reach the Instruction stage.
    await expect(page.getByRole('heading', { name: 'Should not appear' })).toBeHidden();
    // Phase chip in the logs panel reads "aborted".
    await expect(page.getByText('aborted', { exact: true })).toBeVisible();
  });

  test('untyped bpmn:Task renders the generic continue node', async ({ page }) => {
    await runStudyflow(page, 'runner-stages-untyped', UNTYPED_TASK_XML);

    await page.getByRole('button', { name: 'Begin' }).click();

    await expect(page.getByRole('heading', { name: 'Plain task' })).toBeVisible();
    await expect(
      page.getByText('This task has no applied type. Press Continue to advance.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Study complete' })).toBeVisible();
  });

  test('a bound task displays its resolved uses binding and with arguments', async ({ page }) => {
    await runStudyflow(page, 'runner-stages-bound', BOUND_TASK_XML);

    await page.getByRole('button', { name: 'Begin' }).click();

    await expect(page.getByRole('heading', { name: 'Median RT' })).toBeVisible();
    await expect(page.getByText('Would call')).toBeVisible();
    await expect(page.getByText('python://pkg_for_st.do_map@1.2', { exact: true })).toBeVisible();
    // `with` arguments parsed and displayed.
    await expect(page.getByText('median', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Study complete' })).toBeVisible();
  });

  test('a malformed uses binding fails validation before the run starts', async ({ page }) => {
    await runStudyflow(page, 'runner-stages-badbinding', BAD_BINDING_XML);

    await expect(page.getByText(/Invalid 'uses' binding/)).toBeVisible();
    // The run halts at validation; the bound task never renders.
    await expect(page.getByRole('heading', { name: 'Broken binding' })).toBeHidden();
  });
});
