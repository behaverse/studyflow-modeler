import { recordEvents, type DataServerConfig } from '@/runner/dataServer';
import { EVENT } from '@/runner/nodes/behaverse/unityTopics';

// Matches the C# recorder: flush at 64; bound memory at 10k (drop-oldest) so an outage can't grow the buffer.
const BATCH_SIZE = 64;
const MAX_BUFFER = 10_000;

export type EventRecorder = {
  flush: () => Promise<void>;
  stop: () => void;
};

type Options = {
  config: DataServerConfig;
  getAgentId: () => string | undefined;
  onFlush?: (count: number, ok: boolean) => void;
};

export function createEventRecorder(opts: Options): EventRecorder {
  const buffer: unknown[] = [];
  let chain: Promise<void> = Promise.resolve();

  const flushOnce = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    let ok = false;
    try {
      ok = await recordEvents(opts.config, batch, opts.getAgentId());
    } catch {
      ok = false;
    }
    opts.onFlush?.(batch.length, ok);
  };

  const enqueueFlush = (): Promise<void> => {
    chain = chain.then(flushOnce);
    return chain;
  };

  // Unity forwards every event on BOTH a parent CustomEvent and a parent postMessage.
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
