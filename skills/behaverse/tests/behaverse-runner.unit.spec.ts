import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/** `skills/behaverse/local.py`: the behaverse skill's local runner (Unity WebGL), without Unity — the stage page's
 * protocol is exercised by hand, as the page itself would. */

test.skip(spawnSync('uv', ['--version']).error !== undefined, 'uv is not on PATH');

const RUNNER = path.resolve(__dirname, '../local.py');
const BEHAVERSE = 'http://behaverse.org/schemas/studyflow/behaverse';

// The task sends its trials to a step of the robot's pool and takes the answers back, along two message flows.
const PLAN = {
  study: { id: 'S' },
  elements: {
    T: {
      id: 'T', type: 'task', name: 'Play', attributes: {},
      // `timeline` as a Parameters key sets it, as the plan hands it over; the rest is the task's GameConfig.
      extensions: [{ namespace: BEHAVERSE, type: 'task', attributes: { instrument: 'WO', timeline: 'SimonTask' } }],
      parameters: { Bot: { IncludeScreenshot: true } },
    },
    Receive: { id: 'Receive', type: 'receiveTask', parent: 'RobotSteps', attributes: {} },
    Robot: { id: 'Robot', type: 'participant', name: 'Reachy Mini', attributes: { processRef: 'RobotSteps' }, extensions: [] },
    M_Trial: { id: 'M_Trial', type: 'messageFlow', attributes: { sourceRef: 'T', targetRef: 'Receive' } },
    M_Answer: { id: 'M_Answer', type: 'messageFlow', attributes: { sourceRef: 'Receive', targetRef: 'T' } },
    Other: { id: 'Other', type: 'serviceTask', extensions: [{ namespace: 'https://w3id.org/studyflow/reachy', type: 'say', attributes: {} }] },
  },
};

test('claims its tasks, serves the build and the stage, relays what the page reports, and records the completion', async () => {
  test.setTimeout(180_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-behaverse-'));
  const plan = path.join(dir, 'plan.json');
  fs.writeFileSync(plan, JSON.stringify(PLAN));
  const build = path.join(dir, 'build');
  fs.mkdirSync(path.join(build, 'Build'), { recursive: true });
  fs.writeFileSync(path.join(build, 'index.html'), '<canvas id="unity-canvas"></canvas>');
  fs.writeFileSync(path.join(build, 'Build', 'WebGL.wasm.unityweb'), 'wasm');

  // Every BehaverseTask, and only those; without a build the claim fails, before any other pool's runner starts its work.
  const claims = execFileSync('uv', ['run', '--script', RUNNER, plan, '--claims', '--build', build], { stdio: 'pipe' }).toString();
  expect(JSON.parse(claims)).toEqual(['T']);
  expect(() => execFileSync('uv', ['run', '--script', RUNNER, plan, '--claims', '--build', path.join(dir, 'none')],
    { stdio: 'pipe', env: { ...process.env, UNITY_BUILD_PATH: '' } })).toThrow(/no Unity WebGL build/);

  const cache = path.join(dir, 'cache');
  fs.mkdirSync(cache);
  fs.writeFileSync(path.join(cache, 'T.state.json'), JSON.stringify({ S: { seed: 1 } }));

  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn('uv', ['run', '--script', RUNNER, plan, '--element', 'T', '--cache', cache, '--build', build,
    '--port', String(port), '--no-browser', '--timeout', '90'], { stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? -1)));

  const base = `http://127.0.0.1:${port}`;
  let page: Response | undefined;
  for (const deadline = Date.now() + 120_000; Date.now() < deadline && !page;) {
    try { page = await fetch(`${base}/`); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  expect(page?.status).toBe(200);
  const html = await page!.text();
  // Unity gets what the browser runner's parser would build, and waits for each answer from outside.
  expect(JSON.parse(html.match(/const PAYLOAD = (.*);/)![1])).toEqual({
    scene: 'WO', agentType: 'bot', configMode: 'builtin', timeline: 'SimonTask',
    metadata: { studyflowNodeId: 'T' }, bot: { ResponseSource: 'external', IncludeScreenshot: true },
  });
  expect(JSON.parse(html.match(/const STAGE = (.*);/)![1])).toEqual({ scene: 'WO', timeline: 'SimonTask', source: 'messages' });

  expect(await (await fetch(`${base}/assessment-unity/Build/WebGL.wasm.unityweb`)).text()).toBe('wasm');
  expect((await fetch(`${base}/assessment-unity/%2e%2e/plan.json`)).status).toBe(404);

  const post = (route: string, body: unknown) => fetch(base + route, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  // Each trial goes out along the trial flow; the answer naming it comes back into the inbox, as the walk delivers it.
  const outbox = path.join(cache, 'T.outbox.jsonl');
  const inbox = path.join(cache, 'T.inbox.jsonl');
  const ask = async (request: string, window: number, answer?: unknown) => {
    const asked = post('/respond', { RequestId: request, TrialIndex: 0, ResponseOptions: ['Left', 'Right'], MaxResponseTime: window, Scene: 'WO' });
    for (const deadline = Date.now() + 10_000; Date.now() < deadline && !fs.existsSync(outbox);) await new Promise((r) => setTimeout(r, 50));
    if (answer !== undefined) fs.appendFileSync(inbox, `${JSON.stringify({ id: `a-${request}`, flow: 'M_Answer', content: answer, inReplyTo: request })}\n`);
    return (await asked).json();
  };
  expect(await ask('r1', 5, { Choice: ' right.' })).toEqual({ Response: 'Right', Agent: 'Reachy Mini' });
  expect(JSON.parse(fs.readFileSync(outbox, 'utf8').split('\n')[0])).toEqual({
    flow: 'M_Trial', id: 'r1', content: { TrialIndex: 0, ResponseOptions: ['Left', 'Right'], MaxResponseTime: 5, Scene: 'WO' },
  });
  // An answer that names no option, or none within the trial's window, is no answer: a miss, never a stand-in.
  expect(await ask('r2', 5, 'Up')).toEqual({});
  expect(await ask('r3', 1)).toEqual({});
  expect((await post('/event', { type: 'trial', n: 1 })).status).toBe(204);
  await post('/event', { type: 'trial', n: 2 });
  await post('/trial', { TrialIndex: 0, Response: 'Right', Agent: 'Reachy Mini' });
  await post('/completed', { TaskId: 'WO', TimelineId: 'SimonTask', IsCompleted: true });

  expect(await exited, stderr).toBe(0);
  const state = JSON.parse(fs.readFileSync(path.join(cache, 'T.state.json'), 'utf8'));
  expect(state.S).toEqual({ seed: 1 });
  expect(state.result).toMatchObject({ TaskId: 'WO', TimelineId: 'SimonTask', IsCompleted: true, trials: 1 });
  expect(state.durationMs).toBeGreaterThan(0);
  expect(fs.readFileSync(state.result.events, 'utf8').trim().split('\n').map((line) => JSON.parse(line)))
    .toEqual([{ type: 'trial', n: 1 }, { type: 'trial', n: 2 }]);
});
