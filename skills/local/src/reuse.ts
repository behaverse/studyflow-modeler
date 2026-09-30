import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { GATEWAY_TYPES, type Graph } from '@core/engine/graph';
import type { Note, PlanElement, Reuse } from '@core/engine';
import type { ElementRecord, RunRepo } from '@skills/prov/prov';

/**
 * What a re-run reuses (skills/local/SKILL.md, "Re-runs"). A step is skipped when its record still stands: nothing it
 * reads was re-made earlier in this run, its outputs are where it left them, and the commit its record names still
 * holds what it ran with — every artifact it reads or makes, compared by git itself, and its own drawing (at a
 * gateway, the flows it weighs too), read back out of the study that commit carries.
 */

export function humanBytes(count: number): string {
  let size = count;
  for (const unit of ['B', 'KB', 'MB']) {
    if (size < 1024 || unit === 'MB') return unit === 'B' ? `${size.toFixed(0)} ${unit}` : `${size.toFixed(1)} ${unit}`;
    size /= 1024;
  }
  return `${size.toFixed(1)} GB`;
}

const targetsOf = (element: PlanElement): string[] => element.outputs.map((output) => output.target).filter((target): target is string => !!target);

const conditionsOf = (flows: PlanElement[]): string => flows.map((flow) => flow.condition?.body ?? '').join(' ');

export type ReuseOptions = {
  graph: Graph;
  /** The standing records the study carries, by element. */
  prior: Map<string, ElementRecord>;
  repo: RunRepo;
  /** The run directory, where every artifact lives. */
  dir: string;
  /** Directories a boundary input may be staged from. */
  sources: string[];
  /** One element as the study held at `commit` drew it, undefined when that commit has no readable study. */
  drawnAt(commit: string, id: string): string | undefined | null;
  /** One element as this run draws it. */
  drawn(id: string): string;
};

export class Records implements Reuse {
  /** What this run re-made: whatever reads it runs again. */
  readonly tainted = new Set<string>();
  private demanded: Set<string> | undefined;
  private readonly pending = new Map<string, { stale: boolean; verdict?: string }>();
  private readonly names = new Map<string, string>();
  private readonly products = new Set<string>();
  private readonly options: ReuseOptions;

  constructor(options: ReuseOptions) {
    this.options = options;
    const { graph } = options;
    // Identifier-shaped names, every one of them (over-broad by design): a text touches an element when it names its
    // id or its name.
    for (const id of graph.walked) {
      const { name } = graph.elements[id];
      if (name && /^[A-Za-z_]\w*$/.test(name)) this.names.set(id, name);
      for (const target of targetsOf(graph.elements[id])) this.products.add(target);
    }
    this.demanded = this.planDemand();
  }

  get prior(): Map<string, ElementRecord> {
    return this.options.prior;
  }

  private mentions(text: string, id: string): boolean {
    const name = this.names.get(id);
    return text.includes(id) || (!!name && text.includes(name));
  }

  /** What an activity reads: the sources of its data inputs and the names its arguments cite, and the text of its
   * transformations and arguments. */
  private dependencies(element: PlanElement): { sources: Set<string>; text: string } {
    const sources = new Set(element.inputs.map((input) => input.source));
    const texts = element.inputs.flatMap((input) => (input.transformation ? [input.transformation] : []));
    if (element.additionalArguments) {
      texts.push(element.additionalArguments);
      for (const cited of element.additionalArguments.matchAll(/\{\s*([^\W\d][\w-]*)/g)) sources.add(cited[1]);
    }
    return { sources, text: texts.join(' ') };
  }

  private staleInputs(element: PlanElement): boolean {
    if (this.tainted.size === 0) return false;
    const { sources, text } = this.dependencies(element);
    for (const id of this.tainted) {
      const name = this.names.get(id);
      if (sources.has(id) || this.mentions(text, id) || (name && sources.has(name))) return true;
    }
    return false;
  }

  /**
   * The step is not what the commit in its record holds: an artifact it reads or makes differs, by git's own
   * comparison, or its drawing does — its element, and at a gateway the flows it weighs. A record naming no commit
   * cannot be checked, so its step runs once more and leaves one.
   */
  private staleSince(element: PlanElement, prior: ElementRecord | undefined): boolean {
    if (!prior) return false;
    const { graph, repo, drawn, drawnAt } = this.options;
    if (!prior.commit || !repo.active) return true;
    const { sources } = this.dependencies(element);
    const paths = [...new Set([...sources, ...targetsOf(element)].flatMap((id) => graph.uriOf(id) ?? []))].sort();
    if (paths.length > 0 && repo.changedSince(prior.commit, paths)) return true;
    const weighed = [element, ...(GATEWAY_TYPES.has(element.type) ? graph.outgoing.get(element.id) ?? [] : [])];
    return weighed.some(({ id }) => {
      const then = drawnAt(prior.commit!, id);
      return then === undefined || then !== drawn(id);
    });
  }

  /** Who has to run: taint spreads forward from what is gone; memory-only bindings pull backward. */
  private planDemand(): Set<string> | undefined {
    const { graph, prior, dir } = this.options;
    if (prior.size === 0) return undefined;
    const produced = new Map<string, string>();
    const depends = new Map<string, { sources: Set<string>; text: string }>();
    for (const id of graph.walked) {
      const element = graph.elements[id];
      for (const target of targetsOf(element)) produced.set(target, id);
      const read = this.dependencies(element);
      if (read.sources.size > 0 || read.text) depends.set(id, read);
    }
    const eats = (consumer: string, data: string): boolean => {
      const read = depends.get(consumer);
      return !!read && (read.sources.has(data) || this.mentions(read.text, data));
    };
    const present = (id: string): boolean => { const uri = graph.uriOf(id); return !!uri && existsSync(path.join(dir, uri)); };

    // Roots re-run and taint: no surviving record, a recorded artifact the worktree no longer has, or a step that is
    // no longer what its record's commit holds.
    const tainting = new Set<string>();
    for (const id of new Set([...depends.keys(), ...produced.values()])) {
      const element = graph.elements[id];
      const record = prior.get(id);
      const gone = targetsOf(element).some((target) => graph.uriOf(target) && !present(target));
      if (!record || gone || this.staleSince(element, record)) tainting.add(id);
    }
    // Forward: a re-made output makes every recorded consumer stale, and stale re-runs taint on.
    const forward = [...tainting];
    while (forward.length > 0) {
      for (const target of targetsOf(graph.elements[forward.pop()!])) {
        for (const consumer of depends.keys()) {
          if (!tainting.has(consumer) && eats(consumer, target)) {
            tainting.add(consumer);
            forward.push(consumer);
          }
        }
      }
    }
    // Only a gateway that will actually evaluate (no replayable decision, or a tainted condition) needs the
    // memory-only values its conditions read; a replayed gateway needs nothing bound.
    const pulled = new Set<string>();
    for (const id of graph.walked) {
      const element = graph.elements[id];
      if (!GATEWAY_TYPES.has(element.type)) continue;
      const flows = graph.outgoing.get(id) ?? [];
      const conditions = conditionsOf(flows);
      if (!conditions.trim()) continue;
      if (prior.get(id)?.what && !this.staleExpressions(flows, tainting)) continue;
      for (const [data, maker] of produced) if (!graph.uriOf(data) && this.mentions(conditions, data)) pulled.add(maker);
    }
    // Backward: whoever binds a memory-only (or missing) input of a running element must run as well.
    const demanded = new Set<string>();
    const backward = [...tainting, ...pulled];
    while (backward.length > 0) {
      const id = backward.pop()!;
      if (demanded.has(id)) continue;
      demanded.add(id);
      for (const [data, maker] of produced) {
        if (!demanded.has(maker) && eats(id, data) && !present(data)) backward.push(maker);
      }
    }
    return demanded;
  }

  /** A gateway is stale when a condition on any of its flows reads something re-made this run. */
  private staleExpressions(flows: PlanElement[], tainted: Set<string> = this.tainted): boolean {
    const text = conditionsOf(flows);
    return [...tainted].some((id) => this.mentions(text, id));
  }

  /** Verdicts: `skipped`, `volatile` (a memory-only output someone needs), `invalid` (artifact gone), `changed` (the
   * step, or something it reads or made, is not what the record kept). */
  private skipActivity(element: PlanElement, note: Note): string {
    const { graph, prior } = this.options;
    const targets = targetsOf(element);
    // A memory-only output forces a re-run only when this run was analyzed to need the value.
    if (targets.some((target) => !graph.uriOf(target)) && (!this.demanded || this.demanded.has(element.id))) return 'volatile';
    // Consumers load values themselves (partial runners, per hand-off): existence is enough here.
    try {
      for (const target of targets.filter((id) => graph.uriOf(id))) this.ensureArtifact(target, element.id, note);
    } catch {
      return 'invalid'; // a failed staging means a real run
    }
    // Last, so the comparison reads the artifacts as staging and the history have left them.
    return this.staleSince(element, prior.get(element.id)) ? 'changed' : 'skipped';
  }

  private ensureArtifact(id: string, producer: string, note: Note): void {
    const { graph, repo, dir } = this.options;
    const uri = graph.uriOf(id)!;
    const file = path.join(dir, uri);
    if (existsSync(file)) return;
    // The history is this runtime's cache: an output that left the worktree comes back from the commit that made it,
    // rather than from a source directory that may never have held it.
    if (repo.restore(uri, repo.commitForNode(producer))) {
      note('artifact.restored', `    ▤ restore ${uri}  ${humanBytes(statSync(file).size)}, from run history`);
      return;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    for (const directory of this.options.sources) {
      const source = path.join(directory, uri);
      // A resumed study lives in the repository, so the first source can name the very file being staged.
      if (source === file || !existsSync(source)) continue;
      copyFileSync(source, file);
      note('artifact.staged', `    ▤ stage ${uri}  ${humanBytes(statSync(file).size)}, from ${source}`);
      return;
    }
    throw new Error(`${uri} is in none of ${this.options.sources.join(', ')}`);
  }

  /** The boundary inputs an element reads, by data edge or by `{name}` in its arguments, that the repository lacks:
   * one it holds after the hand-off was imported by this run. */
  absentInputs(id: string): Map<string, string> {
    const { graph, dir } = this.options;
    const { sources } = this.dependencies(graph.elements[id]);
    const absent = new Map<string, string>();
    for (const data of graph.walked) {
      const name = graph.plan.names[data];
      const uri = graph.uriOf(data);
      if ((sources.has(data) || (name && sources.has(name))) && uri && !this.products.has(data) && !existsSync(path.join(dir, uri))) {
        absent.set(data, uri);
      }
    }
    return absent;
  }

  // --- what the walk asks ---

  activity(id: string, live: boolean, note: Note): { skipped: boolean; run?: string; superseded?: string } {
    const element = this.options.graph.elements[id];
    const prior = this.prior.get(id);
    const stale = this.staleInputs(element);
    const verdict = prior && !stale && !live ? this.skipActivity(element, note) : undefined;
    if (verdict === 'skipped') return { skipped: true, run: prior!.run };
    this.pending.set(id, { stale, verdict });
    return {
      skipped: false,
      superseded: stale && prior ? `run ${prior.run}'s record superseded — an input was re-made this run`
        : verdict === 'changed' ? `run ${prior!.run}'s record superseded — the step, or what it reads, is not what ${(prior!.commit ?? '?').slice(0, 8)} holds`
          : undefined,
    };
  }

  decision(id: string): { flow: string; run: string } | undefined {
    const { graph } = this.options;
    const prior = this.prior.get(id);
    if (!prior?.what || this.staleExpressions(graph.outgoing.get(id) ?? []) || this.staleSince(graph.elements[id], prior)) return undefined;
    return { flow: prior.what, run: prior.run };
  }

  /** Taint what was re-made, so recorded consumers re-run too; a `volatile` re-run taints nothing. */
  ran(id: string): void {
    const { stale, verdict } = this.pending.get(id) ?? { stale: false };
    if (stale || verdict === 'invalid' || verdict === 'changed' || (!this.prior.has(id) && this.prior.size > 0)) {
      this.tainted.add(id);
      for (const target of targetsOf(this.options.graph.elements[id])) this.tainted.add(target);
    }
  }

  remade(id: string): void {
    this.tainted.add(id);
  }
}
