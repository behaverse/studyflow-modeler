import { expect, test } from '@playwright/test';
import { askBridge, type BridgeReply, type BridgeTrial } from '@skills/behaverse/browser/bridge';

const TRIAL: BridgeTrial = {
  type: 'trial',
  RequestId: 'req-1',
  TrialIndex: 3,
  ResponseOptions: ['Match', 'NonMatch'],
  MaxResponseTime: 5,
  Scene: 'NB',
};

/** Opens on the next microtask and lets the test hand it incoming messages. */
class FakeSocket {
  static last: FakeSocket | undefined;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  url: string;
  private listeners = new Set<(e: MessageEvent) => void>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
    queueMicrotask(() => this.onopen?.());
  }

  addEventListener(_type: string, fn: (e: MessageEvent) => void) { this.listeners.add(fn); }
  removeEventListener(_type: string, fn: (e: MessageEvent) => void) { this.listeners.delete(fn); }
  send(data: string) { this.sent.push(data); }
  receive(data: unknown) {
    for (const fn of [...this.listeners]) fn({ data: JSON.stringify(data) } as MessageEvent);
  }
}

class DeadSocket {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => this.onerror?.());
  }
  addEventListener() {}
  removeEventListener() {}
  send() {}
}

/** The protocol a response bridge (the reachy participant) speaks: a trial out, the reply to that trial back. */
test('askBridge forwards the trial and resolves the matching reply; silence or no bridge resolves undefined', async () => {
  const CASES: { label: string; WS: unknown; timeoutMs: number; replies?: unknown[]; expected: BridgeReply | undefined }[] = [
    {
      label: 'the reply to this trial, past one to another',
      WS: FakeSocket,
      timeoutMs: 1000,
      replies: [
        { type: 'response', RequestId: 'other' },
        { type: 'response', RequestId: 'req-1', Response: 'Match', Agent: { Id: 'reachy:claude:m' } },
      ],
      expected: { response: 'Match', agentId: 'reachy:claude:m' },
    },
    { label: 'no reply within the window', WS: FakeSocket, timeoutMs: 50, replies: [], expected: undefined },
    { label: 'an unreachable bridge', WS: DeadSocket, timeoutMs: 200, expected: undefined },
  ];

  for (const [i, { label, WS, timeoutMs, replies, expected }] of CASES.entries()) {
    // The bridge keeps one socket per URL, so each row asks its own.
    const pending = askBridge(`ws://bridge-${i}`, TRIAL, timeoutMs, WS as typeof WebSocket);
    if (replies) {
      await new Promise((r) => setTimeout(r, 20));
      const socket = FakeSocket.last!;
      expect(JSON.parse(socket.sent[0]), `${label}: the trial sent`).toEqual(TRIAL);
      for (const reply of replies) socket.receive(reply);
    }
    expect(await pending, label).toEqual(expected);
  }
});
