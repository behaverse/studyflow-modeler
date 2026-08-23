/** The response bridge behind `ResponseSource: external`: an embodied participant, e.g. a
 * Reachy Mini in front of the screen (`studyflow-reachy.py --participant`), serves a local
 * WebSocket; the browser forwards each awaiting trial to it and injects the reply into the
 * task. Nothing connected falls back to random, so the documented `external (random)`
 * behavior still holds on an empty machine. */

/** What the browser forwards per trial. The textual stimulus is deliberately withheld;
 * an embodied participant answers from what it sees (its camera, or the screenshot). */
export type BridgeTrial = {
  type: 'trial';
  RequestId: string;
  TrialIndex: number;
  ResponseOptions: string[];
  MaxResponseTime: number;
  Scene: string;
  Prompt?: string;
  LLM?: unknown;
  Screenshot?: string;
};

export type BridgeReply = { response: string; agentId: string };

export const DEFAULT_BRIDGE_URL = 'ws://localhost:8765';

export function readBridgeUrl(bot: unknown): string {
  if (bot && typeof bot === 'object') {
    const value = (bot as Record<string, unknown>).BridgeUrl;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return DEFAULT_BRIDGE_URL;
}

/** The trial's response window, minus a margin for the injection round-trip. */
export function bridgeTimeoutMs(maxResponseTime: number): number {
  return maxResponseTime > 0 ? Math.max(1000, maxResponseTime * 1000 - 250) : 30_000;
}

const sockets = new Map<string, Promise<WebSocket>>();

function connect(url: string, WS: typeof WebSocket): Promise<WebSocket> {
  const cached = sockets.get(url);
  if (cached) return cached;
  const pending = new Promise<WebSocket>((resolve, reject) => {
    const ws = new WS(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`no response bridge at ${url}`));
    ws.onclose = () => sockets.delete(url);
  });
  sockets.set(url, pending);
  pending.catch(() => sockets.delete(url));
  return pending;
}

export async function askBridge(
  url: string,
  trial: BridgeTrial,
  timeoutMs: number,
  WS: typeof WebSocket = globalThis.WebSocket,
): Promise<BridgeReply | undefined> {
  let ws: WebSocket;
  try {
    // A missing bridge should cost a moment, not the whole response window.
    ws = await Promise.race([
      connect(url, WS),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('bridge connect timed out')), Math.min(timeoutMs, 2000))),
    ]);
  } catch {
    return undefined;
  }
  return new Promise<BridgeReply | undefined>((resolve) => {
    const finish = (reply: BridgeReply | undefined) => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      resolve(reply);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    const onMessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(String(e.data)) as { type?: string; RequestId?: string; Response?: string; Agent?: { Id?: string } };
        if (data.type !== 'response' || data.RequestId !== trial.RequestId) return;
        finish(typeof data.Response === 'string'
          ? { response: data.Response, agentId: data.Agent?.Id || 'external' }
          : undefined);
      } catch {
        // not our message
      }
    };
    ws.addEventListener('message', onMessage);
    try {
      ws.send(JSON.stringify(trial));
    } catch {
      finish(undefined);
    }
  });
}

/** Fire-and-forget notification (e.g. `{type: 'completed'}` so the robot can celebrate). */
export function notifyBridge(
  url: string,
  message: Record<string, unknown>,
  WS: typeof WebSocket = globalThis.WebSocket,
): void {
  connect(url, WS).then((ws) => ws.send(JSON.stringify(message))).catch(() => {});
}
