import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';

/** `skills/behaverse/local.py`: the behaverse skill's local runner (Unity WebGL), without Unity or the walk — the
 * stage page's script runs in jsdom for one trial and the rest of its protocol is exercised by hand, as the page would,
 * and so is the walk's (packages/runtime-local/CONTRACT.md). */

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

/** The walk's end of the contract: requests answered by id, and what the runner sends of its own. */
function walkOf(child: ChildProcessWithoutNullStreams) {
  const answers = new Map<string, (answer: any) => void>();
  const sent: any[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method) sent.push(message);
    else answers.get(message.id)?.(message);
  });
  const write = (message: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  return {
    sent,
    notify: (method: string, params: object) => write({ method, params }),
    request: (method: string, params: object) => new Promise<any>((resolve) => {
      const id = `w${answers.size + 1}`;
      answers.set(id, resolve);
      write({ id, method, params });
    }),
  };
}

test('claims its tasks, serves the build and the stage, relays what the page reports, and records the completion', async () => {
  test.setTimeout(180_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-behaverse-'));
  const plan = path.join(dir, 'plan.json');
  fs.writeFileSync(plan, JSON.stringify(PLAN));
  const build = path.join(dir, 'build');
  fs.mkdirSync(path.join(build, 'Build'), { recursive: true });
  fs.writeFileSync(path.join(build, 'index.html'), '<canvas id="unity-canvas"></canvas>');
  fs.writeFileSync(path.join(build, 'Build', 'WebGL.wasm.unityweb'), 'wasm');

  const run = { dir, cache: path.join(dir, '.cache') };
  const start = (...args: string[]) => spawn('uv', ['run', '--script', RUNNER, ...args], { stdio: 'pipe', env: { ...process.env, UNITY_BUILD_PATH: '' } });

  // Without a build it says so when asked what it takes, before any other pool's runner starts its work.
  const lacking = start('--build', path.join(dir, 'none'));
  expect((await walkOf(lacking).request('initialize', { protocol: 2, plan, run })).error.message).toMatch(/build/);
  lacking.kill();

  const context = { subject: 1, state: {} };
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = start('--build', build, '--port', String(port), '--no-browser', '--timeout', '90');
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? -1)));
  const walk = walkOf(child);
  // Every BehaverseTask, and only those.
  expect((await walk.request('initialize', { protocol: 2, plan, run })).result).toMatchObject({ protocol: 2, elements: ['T'] });
  const handed = walk.request('execute', { element: 'T', values: { S: { seed: 1 } } });

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
  const sent = (request: string) => walk.sent.find((message) => message.method === 'message' && message.params.id === request);
  const until = async (done: () => unknown) => {
    for (const deadline = Date.now() + 10_000; Date.now() < deadline && !done();) await new Promise((r) => setTimeout(r, 50));
  };

  // The page's own script, with a stand-in for the build in its frame: each trial the build awaits goes out along the
  // trial flow as the build describes it, its stimulus with it, and the answer naming it is injected.
  const stimulus = { Buttons: [{ position: 'Left', symbol: 'Circle', color: '#FF0000' }, { position: 'Right', symbol: 'Circle', color: '#0000FF' }],
    NeutralSymbol: 'Circle', NeutralColor: '#0000FF' };
  const relayed: Promise<Response>[] = [];
  const stage = new JSDOM(html, {
    url: base, runScripts: 'dangerously',
    beforeParse: (window) => {
      window.fetch = (route: string, init?: RequestInit) => {
        const relay = fetch(base + route, init);
        relayed.push(relay);
        return relay;
      };
    },
  });
  const injected: unknown[] = [];
  const frame = stage.window.document.getElementById('unity') as HTMLIFrameElement;
  Object.assign(frame.contentWindow!, { unityInstance: {
    SendMessage: (_target: string, method: string, value: string) => { if (method === 'InjectResponse') injected.push(JSON.parse(value)); },
  } });
  stage.window.dispatchEvent(new stage.window.CustomEvent('studyflow:AwaitingResponse', {
    detail: { RequestId: 'r0', TrialIndex: 0, Stimulus: stimulus, ResponseOptions: ['Left', 'Right'], MaxResponseTime: 5 },
  }));
  await until(() => sent('r0'));
  expect(sent('r0').params).toEqual({
    element: 'T', flow: 'M_Trial', id: 'r0',
    content: { TrialIndex: 0, Stimulus: stimulus, ResponseOptions: ['Left', 'Right'], MaxResponseTime: 5, Scene: 'WO' },
  });
  walk.notify('message', { element: 'T', message: { id: 'a-r0', flow: 'M_Answer', content: 'Right', inReplyTo: 'r0' } });
  await until(() => injected.length > 0);
  expect(injected[0]).toEqual({ RequestId: 'r0', Response: 'Right', ResponseOptionIndex: 1, Agent: { Id: 'Reachy Mini' } });
  await Promise.all(relayed); // the answered trial the page reports, among them
  stage.window.close();

  // The same exchange, by hand: the answer naming the trial comes back, as the walk delivers it.
  const ask = async (request: string, window: number, answer?: unknown) => {
    const asked = post('/respond', { RequestId: request, TrialIndex: 0, ResponseOptions: ['Left', 'Right'], MaxResponseTime: window, Scene: 'WO' });
    await until(() => sent(request));
    if (answer !== undefined) {
      walk.notify('message', { element: 'T', message: { id: `a-${request}`, flow: 'M_Answer', content: answer, inReplyTo: request } });
    }
    return (await asked).json();
  };
  expect(await ask('r1', 5, { Choice: ' right.' })).toEqual({ Response: 'Right', Agent: 'Reachy Mini' });
  // An answer that names no option, or none within the trial's window, is no answer: a miss, never a stand-in.
  expect(await ask('r2', 5, 'Up')).toEqual({});
  expect(await ask('r3', 1)).toEqual({});
  // The build's own record of each trial is what the failed-trial rate counts: three shown, one answered with a
  // click, one with a response time, one that ended without one — however well the replies above named an option.
  const shown = (n: number) => ({ trialContext: { block: { id: 1 }, trial: { id: n }, types: ['TrialStart'] } });
  expect((await post('/event', shown(1))).status).toBe(204);
  await post('/event', shown(2));
  await post('/event', shown(3));
  await post('/event', { trialContext: { block: { id: 1 }, trial: { id: 1 }, types: ['Click'] } });
  await post('/event', { trialContext: { block: { id: 1 }, trial: { id: 2 }, types: ['TrialEnd'] }, result: { responseTime: 5.5 } });
  await post('/event', { trialContext: { block: { id: 1 }, trial: { id: 3 }, types: ['TrialEnd'] }, result: { responseTime: null } });
  await post('/completed', { TaskId: 'WO', TimelineId: 'SimonTask', IsCompleted: true });

  const { result, durationMs } = (await handed).result;
  expect(result).toMatchObject({ TaskId: 'WO', TimelineId: 'SimonTask', IsCompleted: true, trials: 1 });
  // One of the three trials the build showed ended with no response, and the share rides with the result.
  expect(result.failedTrialRate).toBeCloseTo(1 / 3);
  expect(durationMs).toBeGreaterThan(0);
  await walk.request('shutdown', {});
  expect(await exited, stderr).toBe(0);
  expect(fs.readFileSync(result.events, 'utf8').trim().split('\n').map((line) => JSON.parse(line)))
    // Every event line says whose trial it is: the task's visit count, and the properties in scope at the hand-off.
    .toEqual([shown(1), shown(2), shown(3),
      { trialContext: { block: { id: 1 }, trial: { id: 1 }, types: ['Click'] } },
      { trialContext: { block: { id: 1 }, trial: { id: 2 }, types: ['TrialEnd'] }, result: { responseTime: 5.5 } },
      { trialContext: { block: { id: 1 }, trial: { id: 3 }, types: ['TrialEnd'] }, result: { responseTime: null } },
    ].map((event) => ({ ...event, context })));
});
