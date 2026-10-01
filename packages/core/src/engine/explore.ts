import { dryHost } from '@core/engine/dry';
import { Graph } from '@core/engine/graph';
import type { Host } from '@core/engine/host';
import type { Plan } from '@core/engine/plan';
import { Walk } from '@core/engine/walk';

/**
 * Every way a study can go, walked: soundness, the property of workflow nets that every run can end and ends properly,
 * checked by exploring the runs rather than read off the graph. Each decision the walk would make by data or by chance
 * is a free choice ({@link Host.choose}): a gateway's flow, another pass of a repeating activity, a conditional or timer
 * boundary event, the failure of a step an error boundary event catches. The runs are walked dry, one instance of each
 * pool, depth first over the choices, so what a study's data decides is not what is checked: a path its conditions
 * never take may still be reported.
 *
 * What it finds: a run in which a pool waits for a message none will send (the pools wait for each other, or the
 * sender has ended), a parallel join one of whose tokens can never come, and a message sent that nothing takes. Each
 * comes with the choices that lead to it.
 */
export type Finding = { message: string; path: string[] };

export type Exploration = {
  /** The runs walked, each a different sequence of choices. */
  runs: number;
  /** Whether every sequence was walked, within `maxRuns`. */
  complete: boolean;
  findings: Finding[];
};

export type ExploreOptions = {
  /** The runs to walk at most: the choices multiply. */
  maxRuns?: number;
  /** The passes a repeating activity takes at most in one run: two show what repeating does. */
  maxPasses?: number;
};

const STUCK = /waits along|wait for each other|waits for a message|a parallel join waits/;

export async function explore(plan: Plan, { maxRuns = 2000, maxPasses = 2 }: ExploreOptions = {}): Promise<Exploration> {
  const graph = new Graph(plan);
  const failing = new Set([...graph.boundaries].filter(([, boundaries]) => boundaries.some((boundary) => (boundary.events ?? []).includes('errorEventDefinition'))).map(([id]) => id));
  const findings = new Map<string, Finding>();
  let script: number[] = [];
  let runs = 0;
  for (;;) {
    runs += 1;
    const widths: number[] = [];
    const path: string[] = [];
    const passes = new Map<string, number>();
    const choose = (at: string, options: string[]): string => {
      // A repeating activity goes round at most `maxPasses` times: past that it is done, and no choice is made.
      if (at.endsWith(':again') && (passes.get(at) ?? 1) >= maxPasses) return 'done';
      const k = widths.length;
      widths.push(options.length);
      if (k >= script.length) script.push(0);
      const chosen = options[script[k]];
      if (at.endsWith(':again') && chosen === 'again') passes.set(at, (passes.get(at) ?? 1) + 1);
      path.push(describe(at, chosen));
      return chosen;
    };
    const dry = dryHost(plan);
    const host: Host = {
      ...dry,
      choose,
      perform: async (id, values, step) => {
        if (failing.has(id) && choose(`${id}:fails`, ['ok', 'fails']) === 'fails') throw new Error(`${id} failed`);
        return dry.perform(id, values, step);
      },
      // A timer event passes at once; one at a boundary event runs out or not.
      wait: (_ms, _signal, at) => (graph.elements[at]?.type === 'boundaryEvent' && choose(`${at}:due`, ['not', 'due']) === 'not'
        ? new Promise(() => undefined) : Promise.resolve()),
    };
    const walk = new Walk(plan, host, { seed: null, oneInstance: true, maxSteps: 200 });
    try {
      await walk.run();
      for (const flow of walk.untaken()) note(`a message along ${flow} is sent and nothing takes it`, path);
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      if (STUCK.test(message)) note(message, path);
    }
    // The next sequence: the last choice with an option left takes it, and what follows starts over.
    script = script.slice(0, widths.length);
    while (script.length > 0 && script[script.length - 1] + 1 >= widths[script.length - 1]) script.pop();
    if (script.length === 0) return { runs, complete: true, findings: [...findings.values()] };
    if (runs >= maxRuns) return { runs, complete: false, findings: [...findings.values()] };
    script[script.length - 1] += 1;
  }

  function note(message: string, path: string[]): void {
    if (!findings.has(message)) findings.set(message, { message, path: [...path] });
  }
}

/** A choice, as a path names it: `Gate → F_No`, `Play fails`, `Block again`, `Timer due`, `Task ends at Failed`. */
function describe(at: string, chosen: string): string {
  const [id, what] = at.split(':');
  if (!what) return `${id} → ${chosen}`;
  if (what === 'ends') return chosen === 'none' ? `${id} ends` : `${id} ends at ${chosen}`;
  if (what === 'again') return `${id} ${chosen === 'again' ? 'again' : 'done'}`;
  if (what === 'fails') return `${id} ${chosen === 'fails' ? 'fails' : 'succeeds'}`;
  return `${id} ${chosen}`;
}
