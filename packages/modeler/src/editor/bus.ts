/**
 * The editor's event bus, held as `Editor.events`. `editor/mount.ts` forwards the canvas's and the study's events
 * onto it (`SelectionChanged`, `RootSet`, `ElementsChanged`, `ImportDone`, `HistoryChanged`), and commands travel on
 * it too. Listeners run in subscription order.
 */

/**
 * A bus listener. The payload's shape depends on the topic; see the emitters.
 *
 * `fire` hands back the value a listener returns. A command type (`'Undo'`, `'SetColor'`) is a topic with exactly
 * one listener, whose return value is the command's result; send it with {@link EventBus.send}.
 */
export type EventListener<P = unknown> = (payload: P) => unknown;

/** The message a listener receives, for a command or an event: the payload, with the topic as `type`. */
export type Message<P = unknown> = P & { type: string };

export class EventBus {
  private readonly topics = new Map<string, EventListener<never>[]>();

  on<P = unknown>(topic: string, listener: EventListener<P>): void {
    const subs = this.topics.get(topic) ?? [];
    subs.push(listener as EventListener<never>);
    this.topics.set(topic, subs);
  }

  off<P = unknown>(topic: string, listener: EventListener<P>): void {
    const subs = this.topics.get(topic);
    if (!subs) return;
    const next = subs.filter((s) => s !== (listener as EventListener<never>));
    if (next.length) this.topics.set(topic, next);
    else this.topics.delete(topic);
  }

  /**
   * Fires `topic`: calls its listeners in subscription order and returns the last value one of them returned
   * (`undefined` when none did, as for every notification topic).
   *
   * A listener receives one message, `{ type: topic, ...payload }`, the shape a command has too, so it can read
   * `event.type` off any message. A missing payload is delivered as `{ type }`.
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
   * Runs the command `{ type, ... }` by calling the one listener on topic `type`, then announces `CommandDone`, or
   * `CommandFailed` when it throws. A feature registers a command with `bus.on('SetColor', run)`, as it would a
   * listener, and anything holding the bus may send it.
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
