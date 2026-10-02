import type { LogFn } from '@runner/nodes/types';
import type { Session } from '@runner/session';

/**
 * A skill that watches each run the page plays (a server that records it, say), registered from its browser module
 * the way a node is. `start` may name the run: the id its record and its stamp then carry.
 */
export type RunObserver = {
  start(run: { studyId?: string; agentId: string; log: LogFn }): Promise<{ runId?: string } | void>;
  finish(run: { session: Session; status: 'completed' | 'canceled'; log: LogFn }): Promise<void>;
  /** After the run, however it ended: let go of what `start` took. */
  close?(): Promise<void>;
  /** A switch the runner shows beside its log. */
  toggle?: { label: string; get(): boolean; set(on: boolean): void };
};

const observers: RunObserver[] = [];

export function registerRunObserver(observer: RunObserver): void {
  observers.push(observer);
}

export function getRunObservers(): readonly RunObserver[] {
  return observers;
}
