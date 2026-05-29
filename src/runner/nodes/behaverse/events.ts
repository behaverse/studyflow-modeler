import { recordEvents, type DataServerConfig } from '@/runner/dataServer';

/**
 * Telemetry recorder for the runner.
 *
 * Unity no longer holds a data-server connection: it streams each BDM/xAPI event
 * to the parent runner window as a `studyflow:Event` message (see the WebGL
 * bridge `browser_bridge.jslib` + the WebGLTemplate forwarder). This module
 * buffers those events and batch-POSTs them to the data-server via
 * {@link recordEvents}. The runner owns batching, retry, and delivery.
 */

// PascalCase topic, mirroring the C# source of truth (browser_bridge.jslib) and
// the topic constants in bridge.ts.
const EVENT = 'studyflow:Event';

// Match the batching the C# side used to do: flush at 64 events; bound memory at
// 10k (drop-oldest) so a server outage can't grow the buffer without limit.
const BATCH_SIZE = 64;
const MAX_BUFFER = 10_000;

export type EventRecorder = {
  /** Drain everything currently buffered and POST it. Safe to call repeatedly;
   *  flushes are serialized so batches are sent in order and never overlap. */
  flush: () => Promise<void>;
  /** Detach the listener. Does not flush — call flush() first to drain. */
  stop: () => void;
};

type Options = {
  config: DataServerConfig;
  /** Read lazily so an agent id set after the listener starts is still used. */
  getAgentId: () => string | undefined;
  /** Called after each flush with the batch size and whether the POST succeeded. */
  onFlush?: (count: number, ok: boolean) => void;
};

/** Start recording `studyflow:Event` telemetry from Unity and forwarding it to
 *  the data-server in batches. Returns a handle to flush/stop the recorder. */
export function createEventRecorder(opts: Options): EventRecorder {
  const buffer: unknown[] = [];
  // Serialize flushes by chaining: each flush runs after the previous resolves,
  // so batches POST in order and never overlap.
  let chain: Promise<void> = Promise.resolve();

  const flushOnce = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    let ok = false;
    try {
      ok = await recordEvents(opts.config, batch, opts.getAgentId());
    } catch {
      ok = false; // recordEvents is already best-effort; treat throws as a failed flush.
    }
    opts.onFlush?.(batch.length, ok);
  };

  const enqueueFlush = (): Promise<void> => {
    chain = chain.then(flushOnce);
    return chain;
  };

  // Unity forwards every event on BOTH a parent CustomEvent and a parent
  // postMessage. Telemetry is a continuous STREAM, so — unlike the idempotent
  // TaskCompleted handler and the RequestId-keyed AwaitingResponse handler in
  // bridge.ts — listening on both channels would double-count, and events carry
  // no stable unique id (context.index resets per task). The WebGLTemplate
  // guarantees a parent postMessage for every event, so we subscribe to that one
  // channel: exactly-once delivery with no dedupe key needed.
  const onMessage = (e: MessageEvent) => {
    const data = e.data as { type?: string; detail?: unknown } | undefined;
    if (data?.type !== EVENT) return;
    buffer.push(data.detail);
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
    if (buffer.length >= BATCH_SIZE) void enqueueFlush();
  };

  window.addEventListener('message', onMessage);

  return {
    flush: () => enqueueFlush(),
    stop: () => window.removeEventListener('message', onMessage),
  };
}
