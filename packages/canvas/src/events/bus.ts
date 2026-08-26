/**
 * Minimal event bus (design §3 `events/bus.ts`). A tiny publish/subscribe emitter
 * carrying the topic names the app already subscribes to through the editor facade
 * (`packages/modeler/src/editor/port.ts` `EditorEvents`): `selection.changed`,
 * `element.changed`, `elements.changed`, plus whatever else the canvas fires.
 *
 * The surface mirrors `EditorEvents` — `on`/`off`/`fire` with an optional numeric
 * priority — so the eventual `EditorPort` adapter (design §4) is a thin projection.
 * No dependency on diagram-js's `EventBus`; this is a few dozen lines of vanilla TS.
 */

/** A bus listener. The payload shape is topic-specific; see the emitters. */
export type EventListener<P = unknown> = (payload: P) => void;

interface Subscription {
  priority: number;
  listener: EventListener<never>;
}

/** A small priority-ordered pub/sub emitter. Higher priority runs first. */
export class EventBus {
  private readonly topics = new Map<string, Subscription[]>();

  /** Subscribe `listener` to `topic` (default priority `1000`). */
  on<P = unknown>(topic: string, listener: EventListener<P>): void;
  /** Subscribe `listener` to `topic` at an explicit `priority` (higher runs first). */
  on<P = unknown>(topic: string, priority: number, listener: EventListener<P>): void;
  on<P = unknown>(
    topic: string,
    priorityOrListener: number | EventListener<P>,
    maybeListener?: EventListener<P>,
  ): void {
    const priority = typeof priorityOrListener === 'number' ? priorityOrListener : 1000;
    const listener = (typeof priorityOrListener === 'number'
      ? maybeListener
      : priorityOrListener) as EventListener<never> | undefined;
    if (!listener) return;
    const subs = this.topics.get(topic) ?? [];
    subs.push({ priority, listener });
    // Stable-ish descending sort so higher priority fires first.
    subs.sort((a, b) => b.priority - a.priority);
    this.topics.set(topic, subs);
  }

  /** Remove a previously registered `listener` from `topic`. */
  off<P = unknown>(topic: string, listener: EventListener<P>): void {
    const subs = this.topics.get(topic);
    if (!subs) return;
    const next = subs.filter((s) => s.listener !== (listener as EventListener<never>));
    if (next.length) this.topics.set(topic, next);
    else this.topics.delete(topic);
  }

  /** Fire `topic` with `payload`, invoking listeners in priority order. */
  fire<P = unknown>(topic: string, payload?: P): void {
    const subs = this.topics.get(topic);
    if (!subs || subs.length === 0) return;
    // Copy so listeners may (de)subscribe during dispatch.
    for (const { listener } of subs.slice()) {
      (listener as EventListener<P | undefined>)(payload);
    }
  }

  /** Drop every subscription (used on teardown). */
  clear(): void {
    this.topics.clear();
  }
}
