import { expect, test } from '@playwright/test';

import type { Session } from '@runner/session';
import { setApiKey, setRecordEvents } from '@skills/behaverse/account';
import { createSession, DATA_SERVER_URL, finishSession, loadDataServerConfig } from '@skills/behaverse/browser/dataServer';
import { createEventRecorder, EVENT } from '@skills/behaverse/browser/events';
import { inPage, posted } from '@skills/behaverse/tests/page';

/** A run recorded on the Behaverse Data Server, as the browser runner's observer (browser/recording.ts) drives it:
 * what the server is sent, and what the run's log says. */

const KEY = 'test-key-not-real';
const STUDY = `${DATA_SERVER_URL}/studies/pilot%20study`;
const auth = `Bearer ${KEY}`;
/** More than a batch: the 64th event sends the batch, and the end of the run the rest. */
const EVENTS = Array.from({ length: 65 }, (_, trial) => ({ trial }));
const VARIABLES = { 'end.completionCode': 'C0DE', score: 3 };

test('a recorded run is a session for its agent, the task\'s events in batches, and its end with its variables and code; recording off, the server is sent nothing', async () => {
  const CASES: {
    label: string;
    recording: 'on' | 'off' | 'switched off once the run has started';
    sent: { method: string; url: string; authorization: string; body: unknown }[];
    flushed: [count: number, ok: boolean][];
    logged: string[];
  }[] = [
    {
      label: 'recorded',
      recording: 'on',
      sent: [
        { method: 'POST', url: `${STUDY}/sessions`, authorization: auth, body: { agent_id: 'agent-1' } },
        { method: 'POST', url: `${STUDY}/events?agent_id=agent-1`, authorization: auth, body: EVENTS.slice(0, 64) },
        { method: 'POST', url: `${STUDY}/events?agent_id=agent-1`, authorization: auth, body: EVENTS.slice(64) },
        { method: 'PATCH', url: `${STUDY}/sessions/s1`, authorization: auth, body: { status: 'completed', completion_code: 'C0DE', variables: VARIABLES } },
      ],
      flushed: [[64, true], [1, true]],
      logged: ['info: Session s1 is marked completed on the data server.'],
    },
    // No session on the server, so no recorder either, and nothing to say at the end.
    { label: 'not recorded', recording: 'off', sent: [], flushed: [], logged: [] },
    {
      label: 'switched off once the run has started, it stops at once: the events are dropped, and the end is not sent',
      recording: 'switched off once the run has started',
      sent: [{ method: 'POST', url: `${STUDY}/sessions`, authorization: auth, body: { agent_id: 'agent-1' } }],
      flushed: [[64, false], [1, false]],
      logged: ['skip: Could not save the final state of session. The data server still has it as started.'],
    },
  ];

  const fetchBefore = globalThis.fetch;
  try {
    await inPage(async (page) => {
      setApiKey(KEY);
      for (const { label, recording, sent, flushed, logged } of CASES) {
        const requests: typeof sent = [];
        globalThis.fetch = (async (url: string, init: RequestInit) => {
          const { Authorization: authorization } = init.headers as Record<string, string>;
          requests.push({ method: init.method!, url, authorization, body: JSON.parse(String(init.body)) });
          return url.endsWith('/sessions') ? new Response(JSON.stringify({ _id: 's1' })) : new Response(null, { status: 204 });
        }) as typeof fetch;
        const flushes: [number, boolean][] = [];
        const log: string[] = [];

        setRecordEvents(recording !== 'off');
        const config = loadDataServerConfig('pilot study');
        const handle = await createSession(config, { agentId: 'agent-1' });
        expect(handle.online, label).toBe(recording !== 'off');
        if (recording === 'switched off once the run has started') setRecordEvents(false);
        if (handle.online) {
          const recorder = createEventRecorder({ config, getAgentId: () => 'agent-1', onFlush: (count, ok) => flushes.push([count, ok]) });
          for (const detail of EVENTS) await posted(page, { type: EVENT, detail });
          await posted(page, { type: 'studyflow:TaskCompleted', detail: {} });
          await recorder.flush();
          recorder.stop();
          // Stopped, it takes no more.
          await posted(page, { type: EVENT, detail: { trial: 65 } });
          await recorder.flush();
        }
        await finishSession(config, handle, { getVariables: () => VARIABLES } as unknown as Session, 'completed', (kind, message) => log.push(`${kind}: ${message}`));

        expect(requests, label).toEqual(sent);
        expect(flushes, label).toEqual(flushed);
        expect(log, label).toEqual(logged);
      }
    });
  } finally {
    globalThis.fetch = fetchBefore;
  }
});
