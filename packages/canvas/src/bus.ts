/**
 * The canvas's event bus, a tiny publish/subscribe emitter: the canvas fires `SelectionChanged`,
 * `ElementChanged`, `ElementsChanged` and the rest on it, and the app holds the same bus as
 * `Editor.events` (`packages/modeler/src/editor/port.ts`). Listeners run in subscription order;
 * nothing has needed a priority.
 */

/**
 * A bus listener. The payload shape is topic-specific; see the emitters.
 *
 * A returned value is the ANSWER `fire` hands back. Commands are topics too: a
 * command type (`'Undo'`, `'SetColor'`) is a topic with exactly one listener whose
 * answer is the command's result, sent with {@link EventBus.send}.
 */
export type EventListener<P = unknown> = (payload: P) => unknown;

/** What every listener receives: the topic as `type`, plus the payload. Commands and events alike. */
export type Message<P = unknown> = P & { type: string };

/** A small pub/sub emitter. Listeners fire in the order they subscribed. */
export class EventBus {
  private readonly topics = new Map<string, EventListener<never>[]>();

  /** Subscribe `listener` to `topic`. */
  on<P = unknown>(topic: string, listener: EventListener<P>): void {
    const subs = this.topics.get(topic) ?? [];
    subs.push(listener as EventListener<never>);
    this.topics.set(topic, subs);
  }

  /** Remove a previously registered `listener` from `topic`. */
  off<P = unknown>(topic: string, listener: EventListener<P>): void {
    const subs = this.topics.get(topic);
    if (!subs) return;
    const next = subs.filter((s) => s !== (listener as EventListener<never>));
    if (next.length) this.topics.set(topic, next);
    else this.topics.delete(topic);
  }

  /**
   * Fire `topic` with `payload`, invoking listeners in subscription order, and hand
   * back the last answer any of them returned (`undefined` when none did, which is
   * every notification topic).
   *
   * Listeners receive one message, `{ type: topic, ...payload }` — the same shape a
   * command travels in, so a listener reads `event.element` off a notification and
   * `event.type` off anything. A missing payload is delivered as `{ type }`, never
   * `undefined`.
   */
  fire<R = unknown, P = unknown>(topic: string, payload?: P): R | undefined {
    const subs = this.topics.get(topic);
    if (!subs || subs.length === 0) return undefined;
    const message = { type: topic, ...(payload ?? {}) } as Message<P>;
    let answer: unknown;
    // Copy so listeners may (de)subscribe during dispatch.
    for (const listener of subs.slice()) {
      const returned = (listener as EventListener<Message<P>>)(message);
      if (returned !== undefined) answer = returned;
    }
    return answer as R | undefined;
  }

  /**
   * Run the command `{ type, ... }` — the one listener on topic `type` answers —
   * and announce the fact on `CommandDone` (or `CommandFailed`). Same bus, same
   * `on`: a feature registers `bus.on('SetColor', run)` and anyone holding the bus
   * may send it; nothing else distinguishes a command from an event.
   */
  async send<R = unknown>(command: { type: string } & Record<string, unknown>): Promise<R> {
    const subs = this.topics.get(command.type) ?? [];
    if (subs.length !== 1) throw new Error(`Command '${command.type}' needs exactly one handler, has ${subs.length}`);
    try {
      const result = (await (subs[0] as EventListener<Message>)(command)) as R;
      this.fire('CommandDone', { command, result });
      return result;
    } catch (error) {
      this.fire('CommandFailed', { command, error });
      throw error;
    }
  }

  /** Drop every subscription (used on teardown). */
  clear(): void {
    this.topics.clear();
  }
}
