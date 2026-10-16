import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';

import { evaluateFeel } from '@core/expression/feel';

/** `skills/jspsych/local.py`, the jspsych skill's local runner, without a browser or the walk: its stage page runs in
 * jsdom, where the real jsPsych and its html-keyboard-response plugin, served from node_modules, play an AX-CPT, and the
 * walk's end of the contract (packages/runtime-local/CONTRACT.md) and the actor's are played by hand. */

test.skip(spawnSync('uv', ['--version']).error !== undefined, 'uv is not on PATH');

const RUNNER = path.resolve(__dirname, '../local.py');
const MODULES = path.join(process.cwd(), 'node_modules');
const STUDYFLOW = 'http://behaverse.org/schemas/studyflow/v1';

// The AX-CPT, every letter a trial that takes an answer, the cue and the probe alike: Match on an X right after an A,
// NonMatch to every other letter. A practice block of two pairs, then a test block of ten in the classic schedule:
// seven AX, and one each of AY, BX and BY.
const BLOCKS: [string, string[]][] = [['Practice', ['AX', 'BY']], ['Test', ['AX', 'AX', 'AY', 'AX', 'BX', 'AX', 'AX', 'BY', 'AX', 'AX']]];
const ROWS = BLOCKS.flatMap(([block, pairs]) => pairs.flatMap((pair) => [
  { block, stimulus: `<p class="letter">${pair[0]}</p>`, condition: 'Cue', correct_response: 'j' },
  { block, stimulus: `<p class="letter">${pair[1]}</p>`, condition: pair, correct_response: pair === 'AX' ? 'f' : 'j' },
]));

// The task settings a study wires into its tasks for an actor that is not a person, as for its Behaverse tasks: the actor
// has 3 s for each trial, longer than the protocol's 1 s window; the rest is the Behaverse build's and means nothing here.
const SETTINGS = { Bot: { MaxExternalResponseTime: 3, Speed: 1, SkipInstructions: true, AutoClickInstructions: true, SkipFocusArea: true } };

// One subject's pool, whose task inherits the pool's message flows to the actor's and writes its records to a dataset.
// The plan hands the runner the protocol and the settings wired into the task merged into one `parameters`.
const PLAN = {
  study: { id: 'S', seed: '7' },
  elements: {
    AXCPT: {
      id: 'AXCPT', type: 'choreographyTask', name: 'AX-CPT', parent: 'Subject', attributes: {},
      extensions: [{ namespace: 'http://behaverse.org/schemas/studyflow/cognitive', type: 'cognitiveTask',
        attributes: { platform: 'jspsych', implementation: 'jspsych://html-keyboard-response@8' } }],
      inputs: [{ source: 'Prompt_AXCPT' }, { source: 'Protocol_AXCPT' }, { source: 'Task_Settings' }], outputs: [{ target: 'Trials' }],
      parameters: {
        choices: ['f', 'j'], trial_duration: 1000, data: { task: 'AXCPT' }, timeline_variables: ROWS,
        ResponseOptions: { Match: 'f', NonMatch: 'j' }, ...SETTINGS,
      },
    },
    Protocol_AXCPT: { id: 'Protocol_AXCPT', type: 'dataObjectReference', parent: 'Subject', attributes: {}, extensions: [{ namespace: STUDYFLOW, type: 'parameters', attributes: {} }] },
    Task_Settings: { id: 'Task_Settings', type: 'dataObjectReference', parent: 'Subject', attributes: {}, extensions: [{ namespace: STUDYFLOW, type: 'parameters', attributes: {} }] },
    Prompt_AXCPT: { id: 'Prompt_AXCPT', type: 'dataObjectReference', parent: 'Subject', attributes: {},
      extensions: [{ namespace: 'https://w3id.org/studyflow/agentic', type: 'prompt', attributes: { template: 'Answer Match on an X after an A.' } }] },
    Trials: { id: 'Trials', type: 'dataStoreReference', attributes: { uri: 'data/trials.jsonl' } },
    Subjects: { id: 'Subjects', type: 'participant', name: 'Subjects', attributes: { processRef: 'Subject' } },
    Actor: { id: 'Actor', type: 'participant', name: 'Actor', attributes: {},
      extensions: [{ namespace: STUDYFLOW, type: 'actor', attributes: { implementation: 'ollama://gemma4' } }] },
    Msg_Trial: { id: 'Msg_Trial', type: 'messageFlow', attributes: { sourceRef: 'Subjects', targetRef: 'Actor' } },
    Msg_Response: { id: 'Msg_Response', type: 'messageFlow', attributes: { sourceRef: 'Actor', targetRef: 'Subjects' } },
  },
};

/** The walk's end of the contract: requests answered by id, and each message the runner sends handed to `heard`. */
function walkOf(child: ChildProcessWithoutNullStreams, heard: (params: any) => void) {
  const answers = new Map<string, (answer: any) => void>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method === 'message') heard(message.params);
    else if (!message.method) answers.get(message.id)?.(message);
  });
  const write = (message: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  return {
    notify: (method: string, params: object) => write({ method, params }),
    request: (method: string, params: object) => new Promise<any>((resolve) => {
      const id = `w${answers.size + 1}`;
      answers.set(id, resolve);
      write({ id, method, params });
    }),
  };
}

test('plays an AX-CPT timeline in jsPsych, every trial answered along the pool\'s message flows, and records each trial and each block\'s counts', async () => {
  test.setTimeout(120_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-jspsych-'));
  const plan = path.join(dir, 'plan.json');
  fs.writeFileSync(plan, JSON.stringify(PLAN));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn('uv', ['run', '--script', RUNNER, '--modules', MODULES, '--port', String(port), '--no-browser', '--timeout', '90'], { stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? -1)));

  // The actor, played by hand: it keeps the block's last letter, as a person would, and answers right at once, but in the
  // practice block it answers the BY probe wrong, and in the test block it answers the AY probe with no option, the
  // fourth AX probe after 1.6 s (later than the trial's 1 s window, within the settings' 3 s) and the BX probe after 3.4 s.
  const sent: any[] = [];
  const replies: Promise<void>[] = [];
  let previous = '';
  const walk = walkOf(child, (params) => {
    sent.push(params);
    const { TrialIndex: index, Stimulus: letter } = params.content;
    if (index === 0) previous = '';  // a block starts afresh
    const right = previous === 'A' && letter === 'X' ? ' match.' : 'NonMatch';
    previous = letter;
    const block = params.id.split('.')[2];  // `<step>.<subject>.<block>.<trial>`
    const reply = block === '1' && index === 3 ? 'Match' : block === '2' && index === 5 ? 'Maybe' : right;
    const after = block === '2' ? { 7: 1600, 9: 3400 }[index as number] ?? 0 : 0;
    replies.push(new Promise((resolve) => setTimeout(() => {
      walk.notify('message', { element: 'AXCPT', handoff: 'w2', message: { id: `a-${params.id}`, flow: 'Msg_Response', content: reply, inReplyTo: params.id } });
      resolve();
    }, after)));
  });
  expect((await walk.request('initialize', { protocol: 3, plan, run: { dir, cache: path.join(dir, '.cache') } })).result)
    .toMatchObject({ protocol: 3, elements: ['AXCPT'] });
  const handed = walk.request('execute', {
    element: 'AXCPT', values: { state: { _meta: { instance: { Subjects: 3 } }, Subject: { arm: 'standard' } } },
  });

  // The stage, opened as a browser would; its builds come from the runner, which serves them from node_modules.
  const base = `http://127.0.0.1:${port}`;
  let page: Response | undefined;
  for (const deadline = Date.now() + 60_000; Date.now() < deadline && !page;) {
    try { page = await fetch(`${base}/`); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  expect(page?.status, stderr).toBe(200);
  const html = await page!.text();
  // What jsPsych plays is the protocol: the task settings never reach it, and its trials keep their 1 s window.
  const played = JSON.parse(html.match(/const STAGE = (.*);/)![1]).timeline;
  expect(JSON.stringify(played)).not.toMatch(/Bot|MaxExternalResponseTime|ResponseOptions/);
  expect(played.timeline[0].trial_duration).toBe(1000);
  const stage = new JSDOM(html, {
    url: base, runScripts: 'dangerously', resources: 'usable',
    beforeParse: (window) => { window.fetch = (route: string, init?: RequestInit) => fetch(new URL(route, base), init); },
  });

  const { result, record } = (await handed).result;
  stage.window.close();
  await Promise.all(replies);  // the BX probe's answer comes after its trial is over, to a runner with no step to take it
  await walk.request('shutdown', {});
  expect(await exited, stderr).toBe(0);

  // Each trial went to the actor as the Behaverse runner sends one, along the pool's flow: the prompt wired into the task
  // (the Parameters it reads are no message), then the trial's place in its block, its letter as text, the options, and
  // the seconds it has, the settings' 3; nothing says what the letter is (a cue, a probe and its class) or which answer
  // is right.
  expect(sent).toHaveLength(24);
  expect(sent[0]).toEqual({ element: 'AXCPT', handoff: 'w2', flow: 'Msg_Trial', id: 'AXCPT.3.1.0',
    content: { Prompt_AXCPT: null, TrialIndex: 0, Stimulus: 'A', ResponseOptions: ['Match', 'NonMatch'], MaxResponseTime: 3 } });
  expect(new Set(sent.map((message) => message.content.MaxResponseTime))).toEqual(new Set([3]));
  expect(sent.map((message) => message.id)).toEqual([
    ...[0, 1, 2, 3].map((n) => `AXCPT.3.1.${n}`), ...Array.from({ length: 20 }, (_, n) => `AXCPT.3.2.${n}`)]);
  expect(sent.map((message) => message.content.Stimulus).join('')).toBe(ROWS.map((row) => row.stimulus.replace(/<[^>]+>/g, '')).join(''));

  // The result is the Behaverse runner's: the trials answered, and each block's counts. Two of the test block's twenty
  // went unanswered, the AY probe answered with no option and the BX probe after the settings' deadline, which the share
  // a study writes into its `unanswered` property, by the FEEL it writes for a Behaverse task, reads as one in ten.
  expect(result).toEqual({
    trials: 22, events: path.join(dir, 'data', 'trials.jsonl'),
    blocks: [{ block: 'Practice', trials: 4, answered: 4, unanswered: 0, correct: 3 }, { block: 'Test', trials: 20, answered: 18, unanswered: 2, correct: 18 }],
  });
  expect(evaluateFeel('sum(result.blocks[block in scored_blocks].unanswered) / sum(result.blocks[block in scored_blocks].trials)',
    { result, scored_blocks: ['Test'] })).toEqual({ value: 0.1 });
  expect(record.jspsych).toMatchObject({ version: '8.3.0', plugin: expect.stringMatching(/^html-keyboard-response@2\./),
    builds: ['/modules/jspsych/dist/index.browser.min.js', '/modules/@jspsych/plugin-html-keyboard-response/dist/index.browser.min.js'] });

  // One record per trial, in the battery's shape: the task, block and condition the timeline gives it, what jsPsych made of
  // the answer, the option it was, jsPsych's own data, and whose trial it is.
  const records = fs.readFileSync(result.events, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  expect(records.map((line) => line.trialContext.condition)).toEqual(ROWS.map((row) => row.condition));
  expect(records.map((line) => line.trialContext.block)).toEqual([
    ...Array(4).fill({ id: 1, name: 'Practice' }), ...Array(20).fill({ id: 2, name: 'Test' })]);
  expect(records[5]).toMatchObject({
    object: { name: 'AXCPT.TrialEnd' },
    trialContext: { task: { id: 'AXCPT' }, trial: { id: 6, indexInBlock: 2 }, types: ['TaskEvent', 'BlockEvent', 'TrialEvent', 'TrialEnd'] },
    result: { isAnswered: true, isCorrect: true, response: 'Match' },
    data: { stimulus: '<p class="letter">X</p>', response: 'f', trial_type: 'html-keyboard-response', task: 'AXCPT' },
    context: { subject: 3, state: { arm: 'standard' } },
  });
  expect(records[5].result.responseTime).toBeGreaterThanOrEqual(0);
  expect(records[3].result).toMatchObject({ isAnswered: true, isCorrect: false, response: 'Match' });  // the practice BY, wrong
  // The AX probe answered after 1.6 s, later than its 1 s window but within the settings' 3 s: answered. jsPsych holds the
  // answer at the end of its window, which its own check keeps; the record holds the time it really took.
  expect(records[11]).toMatchObject({ trialContext: { condition: 'AX' }, result: { isAnswered: true, isCorrect: true, response: 'Match' },
    data: { response: 'f', rt: 1000 } });
  expect(records[11].result.responseTime).toBeGreaterThanOrEqual(1.6);
  for (const unanswered of [records[9], records[13]]) {  // the test AY with no option, the BX answered after the deadline
    expect(unanswered.result).toEqual({ isAnswered: false, isCorrect: false, response: null, responseTime: null });
    expect(unanswered.data).toMatchObject({ response: null, rt: null });
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
