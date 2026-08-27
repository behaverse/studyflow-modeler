/**
 * Minimal event bus (design §3 `events/bus.ts`). A tiny publish/subscribe emitter
 * carrying the topic names the app already subscribes to through the editor facade
 * (`packages/modeler/src/editor/port.ts` `EditorEvents`): `selection.changed`,
 * `element.changed`, `elements.changed`, plus whatever else the canvas fires.
 *
 * The surface mirrors `EditorEvents` — `on`/`off`/`fire` — so the `EditorPort`
 * adapter (design §4) is a thin projection. Listeners run in SUBSCRIPTION order:
 * nothing in the canvas or the app has ever needed to jump the queue, so there is no
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

  /** Fire `topic` with `payload`, invoking listeners in subscription order. */
  fire<P = unknown>(topic: string, payload?: P): void {
    const subs = this.topics.get(topic);
    if (!subs || subs.length === 0) return;
    // Copy so listeners may (de)subscribe during dispatch.
    for (const listener of subs.slice()) {
      (listener as EventListener<P | undefined>)(payload);
    }
  }

  /** Drop every subscription (used on teardown). */
  clear(): void {
    this.topics.clear();
  }
}
