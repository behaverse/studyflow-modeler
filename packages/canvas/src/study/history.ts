/** How many edits an undo can go back through. */
const UNDO_DEPTH = 50;

/** Edits of one run this close together are one undo step. */
const RUN_WINDOW_MS = 1000;

/**
 * A study's undo history: the document after each edit, oldest first, and the one the study holds. Edits made under
 * one run key (`runAs`), each within `RUN_WINDOW_MS` of the last, are one step: a run of arrow-key nudges, a field
 * being typed into.
 */
export class History<Snapshot> {
  private snapshots: Snapshot[];
  private current = 0;
  /** The run the edit under way belongs to, and the run the last edit did, with when it was made. */
  private runKey?: string;
  private run?: { key: string; at: number };
  /** Whether the edit under way joins the step the study holds rather than making one (`amend`). */
  private amending = false;

  constructor(first: Snapshot) {
    this.snapshots = [first];
  }

  /** The document the study holds. */
  get now(): Snapshot {
    return this.snapshots[this.current];
  }

  get canUndo(): boolean {
    return this.current > 0;
  }

  get canRedo(): boolean {
    return this.current < this.snapshots.length - 1;
  }

  /** Start over from `snapshot`, with nothing to undo or redo: a load. */
  reset(snapshot: Snapshot): void {
    this.snapshots = [snapshot];
    this.current = 0;
    this.run = undefined;
  }

  /**
   * An edit: `snapshot` is the newest step, unless it is the one the study holds. An edit that carries on the last
   * one's run takes the place of its step, so the run undoes as one.
   */
  record(snapshot: Snapshot): void {
    const now = Date.now();
    const carriesOn = this.runKey !== undefined && this.run?.key === this.runKey && now - this.run.at <= RUN_WINDOW_MS;
    if (snapshot !== this.now) {
      if (this.amending || (carriesOn && this.current > 0)) this.snapshots[this.current] = snapshot;
      else this.push(snapshot);
    }
    this.run = this.runKey === undefined ? undefined : { key: this.runKey, at: now };
  }

  /** `snapshot` as a step of its own, whatever run is under way. */
  push(snapshot: Snapshot): void {
    this.snapshots.length = this.current + 1;
    this.snapshots.push(snapshot);
    if (this.snapshots.length > UNDO_DEPTH + 1) this.snapshots.shift();
    this.current = this.snapshots.length - 1;
    this.run = undefined;
  }

  /** Step back or forward: the snapshot there, now the one held, or nothing past either end. */
  travel(step: -1 | 1): Snapshot | undefined {
    const snapshot = this.snapshots[this.current + step];
    if (snapshot === undefined) return undefined;
    this.current += step;
    this.run = undefined;
    return snapshot;
  }

  /** Forget the steps ahead of the one held: what a refused edit wrote is no state to go forward to. */
  truncate(): void {
    this.snapshots.length = this.current + 1;
  }

  /** Make what `edit` records part of the step the study holds, so one undo takes both back; on the first step, the
   * load, it is no step to undo at all. */
  amend(edit: () => void): void {
    this.amending = true;
    try {
      edit();
    } finally {
      this.amending = false;
    }
  }

  /** Make the edits `edit` records part of the run `key`. */
  runAs(key: string, edit: () => void): void {
    this.runKey = key;
    try {
      edit();
    } finally {
      this.runKey = undefined;
    }
  }
}
