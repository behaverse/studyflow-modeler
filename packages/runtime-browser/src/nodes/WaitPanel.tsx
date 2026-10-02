import { useEffect, useState, type ReactNode } from 'react';
import { NodePanel } from '@runner/nodes/NodePanel';
import { nodeStyles } from '@runner/nodes/styles';

/** What the session adds to a timer event's job as the walk starts waiting: when the wait ends, in ms since the epoch. */
export type Waiting = { until?: number };

/** The clock, read four times a second. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);
  return now;
}

/** Seconds as `m:ss`, `h:mm:ss` from an hour on. */
function clock(seconds: number): string {
  const ss = String(seconds % 60).padStart(2, '0');
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}:${ss}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${ss}`;
}

/**
 * A timer event's screen: what the participant does meanwhile, and the time left until `until`. The walk keeps the
 * time and the page drops the screen when it is up, so the screen has no button.
 */
export function WaitPanel({ title, until, children }: { title: string; until?: number; children?: ReactNode }) {
  const now = useNow();
  return (
    <NodePanel>
      <h2 className={nodeStyles.title}>{title}</h2>
      {children}
      {until !== undefined && (
        <p className={nodeStyles.countdown} role="timer" aria-label="Time left">
          {clock(Math.max(0, Math.ceil((until - now) / 1000)))}
        </p>
      )}
    </NodePanel>
  );
}
