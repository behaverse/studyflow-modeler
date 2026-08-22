import { expect, test } from '@playwright/test';
import { askBridge, bridgeTimeoutMs, readBridgeUrl, DEFAULT_BRIDGE_URL, type BridgeTrial } from '@runner/nodes/behaverse/bridge';
import { botForUnity } from '@runner/nodes/behaverse/botConfig';

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

test('readBridgeUrl: defaults to localhost and honors BridgeUrl', () => {
  expect(readBridgeUrl(undefined)).toBe(DEFAULT_BRIDGE_URL);
  expect(readBridgeUrl({ ResponseSource: 'external' })).toBe(DEFAULT_BRIDGE_URL);
  expect(readBridgeUrl({ BridgeUrl: 'ws://lab-mac:9001' })).toBe('ws://lab-mac:9001');
});

test('bridgeTimeoutMs: response window minus margin, floored, unpaced gets a generous default', () => {
  expect(bridgeTimeoutMs(5)).toBe(4750);
  expect(bridgeTimeoutMs(1)).toBe(1000);
  expect(bridgeTimeoutMs(0)).toBe(30_000);
});

test('askBridge: forwards the trial and resolves the matching reply', async () => {
  const WS = FakeSocket as unknown as typeof WebSocket;
  const pending = askBridge('ws://test-reply', TRIAL, 1000, WS);
  await new Promise((r) => setTimeout(r, 20));

  const socket = FakeSocket.last!;
  expect(JSON.parse(socket.sent[0]).RequestId).toBe('req-1');
  socket.receive({ type: 'response', RequestId: 'other' });
  socket.receive({ type: 'response', RequestId: 'req-1', Response: 'Match', Agent: { Id: 'reachy:claude:m' } });

  expect(await pending).toEqual({ response: 'Match', agentId: 'reachy:claude:m' });
});

test('askBridge: no reply within the window resolves undefined', async () => {
  const WS = FakeSocket as unknown as typeof WebSocket;
  expect(await askBridge('ws://test-silent', { ...TRIAL, RequestId: 'req-2' }, 50, WS)).toBeUndefined();
});

test('askBridge: an unreachable bridge resolves undefined instead of throwing', async () => {
  const WS = DeadSocket as unknown as typeof WebSocket;
  expect(await askBridge('ws://test-dead', TRIAL, 200, WS)).toBeUndefined();
});

test('BridgeUrl is runner-only: stripped before the payload reaches Unity', () => {
  const bot = botForUnity({ ResponseSource: 'external', BridgeUrl: 'ws://lab-mac:9001', Speed: 20 });
  expect(bot).toEqual({ ResponseSource: 'external', Speed: 20 });
});
