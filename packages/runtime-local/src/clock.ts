/**
 * The clock a local run's timers wait on. By default it is the machine's: a timer of three weeks (`P21D`) waits three
 * weeks. `studyflow run --clock virtual` gives the walk this one instead, so a study whose sessions are days apart runs
 * in the time its steps take.
 *
 * Virtual time starts at the run's start and passes as the machine's does, and whenever the walk is idle it jumps
 * ahead to the earliest timer still waiting, which then runs out. The walk is idle when no hand-off is in progress
 * and nothing it awaits can happen but by a timer: every path waits at a timer, for a message from another pool (the
 * analysis waiting for every subject), or for an answer a pool's runner left unanswered (a participant who never
 * replies). A hand-off in progress (a task its runner plays, a message to a pool a runner plays) keeps the clock from
 * jumping, so a timer at a boundary event runs out ahead of an answer only when no answer is on its way. Timers that
 * run out at one moment run out in the order they were set. Times a run records by this clock (a step's start, how
 * long a rest lasted) are virtual; what a runner measures itself (a trial's latency) stays real.
 */
export class VirtualClock {
  /** How far virtual time is ahead of the machine's, in ms: the sum of its jumps. */
  private offset = 0;
  /** Hand-offs in progress. */
  private busy = 0;
  private set = 0;
  private readonly pending: { due: number; order: number; at: string; ring: () => void }[] = [];
  private alarm: ReturnType<typeof setTimeout> | undefined;
  private checking = false;
  private stopped = false;
  private readonly jumped: (at: string, by: number) => void;

  /** `jumped` hears each jump: the timer it was for, and by how many ms the clock moved ahead. */
  constructor(jumped: (at: string, by: number) => void = () => undefined) {
    this.jumped = jumped;
  }

  /** Virtual time, in ms since the epoch. */
  now(): number {
    return Date.now() + this.offset;
  }

  /** Resolves once virtual time has come `ms` from now, for the timer event `at`, unless `signal` aborts first. */
  wait(ms: number, signal: AbortSignal, at: string): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted || this.stopped) return;
      const timer = { due: this.now() + Math.max(0, ms), order: this.set += 1, at, ring: resolve };
      this.pending.push(timer);
      this.pending.sort((a, b) => a.due - b.due || a.order - b.order);
      signal.addEventListener('abort', () => {
        const index = this.pending.indexOf(timer);
        if (index >= 0) this.pending.splice(index, 1);
        this.arm();
      }, { once: true });
      this.arm();
      this.idle();
    });
  }

  /** A hand-off, during which the clock does not jump. */
  async during<T>(work: () => Promise<T>): Promise<T> {
    this.busy += 1;
    try {
      return await work();
    } finally {
      this.busy -= 1;
      this.idle();
    }
  }

  /** The timers stop: nothing more runs out, and the process may exit. */
  stop(): void {
    this.stopped = true;
    this.pending.splice(0);
    if (this.alarm) clearTimeout(this.alarm);
    this.alarm = undefined;
  }

  /** The machine's clock still runs: the earliest timer runs out on time if no jump comes first. */
  private arm(): void {
    if (this.alarm) clearTimeout(this.alarm);
    this.alarm = undefined;
    if (this.stopped || this.pending.length === 0) return;
    this.alarm = setTimeout(() => this.ring(), Math.max(0, this.pending[0].due - this.now()));
  }

  /** Every timer whose time has come runs out, in order. */
  private ring(): void {
    const now = this.now();
    while (this.pending.length > 0 && this.pending[0].due <= now) this.pending.shift()!.ring();
    this.arm();
    this.idle();
  }

  /**
   * Whether the walk is idle, asked once what it was doing has settled: a hand-off's answer and a timer's ring reach it
   * as a promise settles, and everything that follows from them (the next steps, the next hand-off begun) happens
   * before the event loop's next turn. So two turns later, with no hand-off in progress, every path waits for what only
   * a timer can bring about, and the clock jumps to the earliest.
   */
  private idle(): void {
    if (this.checking || this.stopped) return;
    this.checking = true;
    setImmediate(() => setImmediate(() => {
      this.checking = false;
      if (this.stopped || this.busy > 0 || this.pending.length === 0) return;
      const [first] = this.pending;
      const by = first.due - this.now();
      if (by > 0) {
        this.offset += by;
        this.jumped(first.at, by);
      }
      this.ring();
    }));
  }
}
