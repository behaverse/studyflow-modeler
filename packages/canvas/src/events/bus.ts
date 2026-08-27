/**
 * Minimal event bus (design §3 `events/bus.ts`). A tiny publish/subscribe emitter
 * carrying the topic names the app subscribes to through the editor facade:
 * `selection.changed`, `element.changed`, `elements.changed`, plus whatever else the
 * canvas fires.
 *
 * This IS `Editor.events` — the facade publishes the bus itself rather than a
 * projection of it (`../editor.ts`). Listeners run in SUBSCRIPTION order: nothing
 * in the canvas or the app has ever needed to jump the queue, so there is no
 * priority to reason about.
 */

/** A bus listener. The payload shape is topic-specific; see the emitters. */
export type EventListener<P = unknown> = (payload: P) => void;

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
   * Fire `topic` with `payload`, invoking listeners in subscription order.
   *
   * A missing payload is delivered as `{}`, never `undefined`: app-side listeners
   * read `event.element` off whatever arrives, and a bare `fire('tokenSimulation.toggle')`
   * would otherwise throw inside the listener rather than say "nothing to report".
   */
  fire<P = unknown>(topic: string, payload?: P): void {
    const subs = this.topics.get(topic);
    if (!subs || subs.length === 0) return;
    const event = (payload ?? {}) as P;
    // Copy so listeners may (de)subscribe during dispatch.
    for (const listener of subs.slice()) {
      (listener as EventListener<P>)(event);
    }
  }

  /** Drop every subscription (used on teardown). */
  clear(): void {
    this.topics.clear();
  }
}
