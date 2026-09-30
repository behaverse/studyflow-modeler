/**
 * The local runtime: it hosts the walk (packages/core/src/engine) on this machine. It never executes an element
 * itself: each skill's `runtimes.local` command is started once, asked for its claims and then handed one element at
 * a time (SKILL.md, beside this folder, is that contract). What a run leaves is a run directory, `--repo DIR` or else
 * `~/.studyflow/runs/<id>/` (YYMMDD plus a codename, `260821heron/`), or the one the study handed to it already
 * lives in: the artifacts the `uri`s name, a copy of the study stamped `executed`, `studyflow.log` and the journal,
 * all in a git repository whose commit bodies hold the step records (skills/prov).
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { readState, writeState } from '@core/document';
import type { Moddle, ModdleElement } from '@core/element/moddle';
import { CONTAINER_TYPES, Walk, indexOf, planElement, planOf, recordOf, stateOf, type Entry, type Host, type Note, type RunEvent } from '@core/engine';
import { RunLog, timelineTimestamp } from '@skills/local/src/log';
import { Records, humanBytes } from '@skills/local/src/reuse';
import { PartialRunner, discoverRunners, type RunnerCommand } from '@skills/local/src/runners';
import { RunRepo, TIMELINE_FIELDS, branchPoint, currentUser, elementRecords, invalidatedElements, stampElement, type Stamp } from '@skills/prov/prov';

export type LocalRun = {
  /** The study file as given. */
  input: string;
  definitions: ModdleElement;
  moddle: Moddle;
  /** Writes the study to `target`, in the format the original is spelled in. */
  write(definitions: ModdleElement, target: string): Promise<void>;
  /** Reads a study back from the bytes a commit holds under the archive's name; undefined when it will not read. */
  read(bytes: Uint8Array): Promise<ModdleElement | undefined>;
  /** Where the shipped skills are: the checkout's `skills/`, or `libexec/skills` as installed. */
  skillRoots: string[];
  /** The protocol's digest (core's `protocolDigest`), recorded as the run's `plan`. */
  digest: string;
  /** What the run record names as the tool that ran it. */
  tool: string;
  /** The run repository to write into, its name being the run id. */
  repo?: string;
  /** More directories to stage boundary inputs from, after the study's own and before the working directory. */
  inputs?: string[];
  /** Re-run from this point in the repository's history (a commit-ish), branching there. */
  from?: string;
  /** Ignore the study's per-element run records and re-run every step. */
  fresh?: boolean;
  quiet?: boolean;
  /** `NAME=COMMAND`: override a discovered partial runner, or add one. */
  runners?: string[];
  /** Keep the `.cache` folder with the run's values after each element, and write the debug lines to the log. */
  debug?: boolean;
  /** `NAME[=VALUE]` options for the runners, in plan.json `options`. */
  options?: string[];
  /** Seconds a hand-off may take before it is stopped, and its step fails. */
  stepTimeout?: number;
};

/** Short words for a run id's codename tail, drawn from the run's exact start moment. */
const ANIMALS = [
  'cat', 'dog', 'bee', 'crab', 'deer', 'dove', 'elk', 'finch', 'fox', 'ibis', 'lark', 'lynx', 'mole', 'moth', 'otter', 'owl', 'seal', 'sparrow',
  'swan', 'trout', 'shark', 'tiger', 'toad', 'tuna', 'viper', 'whale', 'wolf', 'zebra', 'jellyfish', 'kangaroo', 'lemur', 'monkey', 'octopus',
];

/** Sortable, human-trackable id: YYMMDD plus a codename the start moment draws (260821otter). */
function runStamp(moment: Date): string {
  return `${moment.toISOString().slice(2, 10).replaceAll('-', '')}${ANIMALS[moment.getTime() % ANIMALS.length]}`;
}

/** An explicit `--repo`, else the study's own directory when it is a run repository, else a fresh one. */
function resolveRepoDir(explicit: string | undefined, input: string, started: Date): string {
  if (explicit !== undefined) {
    // `studyflow.log` is what marks a directory as ours; without it a run would sweep a stranger's files.
    const occupied = existsSync(explicit) && (!statSync(explicit).isDirectory() || readdirSync(explicit).length > 0);
    if (occupied && !existsSync(path.join(explicit, 'studyflow.log'))) {
      throw new Error(`${explicit} is not a studyflow run repository (no studyflow.log in it). `
        + 'Point --repo at an earlier run\'s directory, or at a new one.');
    }
    return path.resolve(explicit);
  }
  if (existsSync(path.join(path.dirname(input), 'studyflow.log'))) return path.resolve(path.dirname(input));
  const runs = path.join(homedir(), '.studyflow', 'runs');
  const stamp = runStamp(started);
  let candidate = path.join(runs, stamp);
  for (let attempt = 2; existsSync(candidate); attempt += 1) candidate = path.join(runs, `${stamp}${attempt}`);
  return candidate;
}

export async function runLocal(run: LocalRun): Promise<number> {
  // Every runner it starts is told when the run is over, however it ends.
  const started: PartialRunner[] = [];
  try {
    return await hostRun(run, started);
  } finally {
    await Promise.all(started.map((runner) => runner.shutdown()));
  }
}

async function hostRun(run: LocalRun, runners: PartialRunner[]): Promise<number> {
  const { definitions, moddle } = run;
  const started = new Date();
  const stamp = runStamp(started);
  const dir = resolveRepoDir(run.repo, run.input, started);
  const runId = path.basename(dir);
  const log = new RunLog(run.quiet ?? false, run.debug ?? false);
  log.start(dir);
  const who = currentUser();
  const repo = new RunRepo(dir, log.event);
  // A run interrupted mid-commit leaves git's lock behind; nothing else commits into a run repository.
  rmSync(path.join(dir, '.git', 'index.lock'), { force: true });
  repo.open();
  const startedAt = timelineTimestamp(started);
  // A repository created just now has nothing to attribute to anyone: its baseline is the `started` commit.
  if (!repo.created && repo.dirty()) repo.commit('changed outside a run', { 'Prov-Action': 'modified', 'Prov-When': startedAt }, startedAt);

  const index = indexOf(definitions);
  const elements = [...index.walked.values()].map(({ element }) => element);
  const sources = [...new Set([path.resolve(path.dirname(run.input)), ...(run.inputs ?? []).map((input) => path.resolve(input)), process.cwd()])];
  const options = Object.fromEntries((run.options ?? []).map((option) => {
    const at = option.indexOf('=');
    return at < 0 ? [option, true] : [option.slice(0, at), option.slice(at + 1)];
  }));
  const plan = planOf(definitions, { options, sources });
  // Root seed: read from the study, never drawn here. Partial runners read the same plan, so every process seeds
  // identically. A study without a seed runs unseeded.
  const { seed } = plan.study;

  // The runners, once the study is read: its `dependencies` go into every script runner's environment.
  const commands = discoverRunners(run.skillRoots, plan.study.dependencies);
  for (const spec of run.runners ?? []) {
    const at = spec.indexOf('=');
    if (at < 1 || at === spec.length - 1) throw new Error(`--runner wants NAME=COMMAND, got '${spec}'`);
    commands.set(spec.slice(0, at), { command: spec.slice(at + 1) });
  }

  // The records the study carries, read before this run stamps its own. The input file is never touched; the stamp
  // lands on the archived copy.
  let prior = run.fresh ? new Map() : elementRecords(elements);
  const invalidated = invalidatedElements(elements);

  // Branching has first claim on the run's branch name; a detached HEAD only attaches without one.
  let branched = false;
  if (repo.active && (run.from || invalidated.length > 0)) {
    const point = branchPoint(repo, invalidated, run.from);
    // Branches are the only refs; runs live as `started`/`finished` boundary commits.
    const branch = `run/${stamp}`;
    if (point && repo.branch(branch, `${point}^`)) {
      branched = true;
      // The checkout replaced the file the log had open; this run's log starts here.
      log.start(dir);
      log.event('git.branched', `  ${branch} at the parent of ${point} — re-running from there`);
    } else if (!point) {
      log.event('git.branchpoint.missing', `  ${run.from || invalidated.join(', ')} has no commit this history can branch at — re-running in place instead of branching`, { level: 'warning' });
    }
  }
  if (repo.active && !branched && !repo.currentBranch() && repo.branch(`run/${stamp}`)) {
    // A commit checked out by hand: this run gets a branch, not commits nothing points at.
    log.event('git.branched', `  run/${stamp} at the detached HEAD this run started from`);
  }
  if (branched) {
    // The checkout took out of the worktree what was made after the branch point, files or not: the records of that
    // work go with it, so those steps re-run.
    const history = repo.executed();
    prior = new Map([...prior].filter(([id, record]) => history.has(`${id} ${record.when}`)));
  }

  // A run in a history redoes the run before it: it walks the study from its start again, reusing what still
  // stands. So it starts from the state that run started from, as the study archived at that run's start holds it,
  // and what it walks again counts, and draws, as it did then. The timeline of runs (`_meta.prov`) is history, and
  // keeps growing.
  const archive = path.join(dir, path.basename(run.input));
  let state = readState(definitions);
  const redone = repo.lastStarted();
  const then = redone ? repo.fileAt(redone, path.basename(archive)) : undefined;
  const earlier = then && await run.read(then).catch(() => undefined);
  if (earlier) {
    const { prov } = state._meta ?? {};
    state = readState(earlier);
    if (prov) (state._meta ??= {}).prov = prov;
    else delete state._meta?.prov;
    log.event('state.restored', `  from ${redone!.slice(0, 8)}, where the run this one redoes started`, { level: 'debug' });
  }
  const numeric = seed !== null && seed.trim() !== '' && Number.isFinite(Number(seed));
  const document: Stamp = { action: 'executed', when: startedAt, who, with: run.tool, run: runId, seed: numeric ? Number(seed) : seed ?? undefined, plan: run.digest };
  const timeline = Object.fromEntries(TIMELINE_FIELDS.flatMap((name) => (document[name] ? [[name, document[name]]] : [])));
  ((state._meta ??= {}).prov ??= []).push(timeline);
  writeState(definitions, moddle, state);

  // Archived before the first step, so a killed run still leaves a readable study behind.
  mkdirSync(dir, { recursive: true });
  await run.write(definitions, archive);
  log.event('diagram.archived', `  → ${archive}`, { level: 'debug' });

  // Partial runners never open the study: they read `.cache/plan.json`. Each is started once, and asked which ids it
  // will run.
  const cache = path.join(dir, '.cache');
  const claimed = new Map<string, { runner: PartialRunner; live: boolean }>();
  const local = run.skillRoots.map((root) => path.join(root, 'local')).find((folder) => existsSync(path.join(folder, 'runner.py')));
  if (commands.size > 0) {
    mkdirSync(cache, { recursive: true });
    writeFileSync(path.join(cache, 'plan.json'), JSON.stringify(plan, null, 1));
  }
  for (const [name, command] of commands) runners.push(new PartialRunner(name, command as RunnerCommand, dir, log, { timeout: run.stepTimeout, local }));
  // Every runner is asked at once; a claim is settled in the order the runners were found.
  const answers = await Promise.all(runners.map(async (runner) => ({ runner, answer: await runner.claims() })));
  for (const { runner, answer } of answers) {
    if (!answer) {
      log.event('runner.unavailable', `  the ${runner.name} runner needs ${runner.argv[0]}, which is not on this machine: it claims nothing`, { level: 'warning' });
      continue;
    }
    const { elements: ids, live } = answer;
    for (const id of ids) {
      const other = claimed.get(id)?.runner;
      if (other && other !== runner) {
        throw new Error(`${id} is claimed by both the ${other.name} and ${runner.name} runners — one element, one runner (drop one, or scope their claims apart)`);
      }
      claimed.set(id, { runner, live });
    }
  }
  // A runner with nothing to run in this study is not kept waiting for it.
  const taking = new Set([...claimed.values()].map(({ runner }) => runner));
  await Promise.all(runners.filter((runner) => !taking.has(runner)).map((runner) => runner.shutdown()));

  // What the study at a commit drew, by element, read once per commit.
  const studies = new Map<string, Map<string, string> | undefined>();
  const drawnAt = (commit: string, id: string): string | undefined | null => {
    if (!studies.has(commit)) studies.set(commit, undefined);
    return studies.get(commit) === undefined ? undefined : studies.get(commit)!.get(id) ?? null;
  };
  const drawn = (element: ModdleElement): string => JSON.stringify(planElement(element));
  for (const commit of new Set([...prior.values()].flatMap((record) => record.commit ?? []))) {
    const bytes = repo.fileAt(commit, path.basename(archive));
    const then = bytes && await run.read(bytes).catch(() => undefined);
    if (then) studies.set(commit, new Map([...indexOf(then).walked].map(([id, { element }]) => [id, drawn(element)])));
  }

  // The walk and what it may reuse are made below, from the host that serves them.
  const made = {} as { walk: Walk; records: Records };
  /** The run's record (packages/core/src/engine/record.ts): each event appended to `events.jsonl` as it happens. A step
   * that settles is a checkpoint: what it wrote in the run directory, committed under trailers that restate it; the
   * record is committed with the run's `started` and `finished` commits. */
  const events: RunEvent[] = [];
  const keep = (event: RunEvent): void => {
    if (event.event === 'reused') event.trusted = prior.get(event.id)?.when ?? '';
    events.push(event);
    log.record(event);
    const settles = event.event === 'executed' || event.event === 'failed' || event.event === 'reused';
    if (!settles || (plan.elements[event.id]?.type ?? '').endsWith('Event')) return;
    const { id, at } = event;
    const flow = 'flow' in event ? event.flow : undefined;
    const node = { 'Prov-Run': runId, 'Prov-When': at, 'Prov-Node': id };
    if (event.event === 'failed') repo.checkpoint(`failed ${id}`, node, at);
    else if (event.event === 'reused') repo.checkpoint(`skipped ${id} (${flow ? `${flow}, ` : ''}run ${event.run})`, node, at);
    else repo.checkpoint(flow ? `executed ${id}: ${flow}` : `executed ${id}`, { ...node, 'Prov-Action': 'executed', ...(flow ? { 'Prov-What': flow } : {}) }, at);
  };

  const host: Host = {
    claim: (id) => { const claim = claimed.get(id); return claim && { name: claim.runner.name, live: claim.live }; },
    perform: async (id, values, { message, conversation, talk, note, signal }) => {
      // A runner stages the boundary inputs it reads: one the repository lacks before the hand-off and holds after it
      // was imported by this run.
      const absent = made.walk.graph.walked.has(id) ? made.records.absentInputs(id) : new Map<string, string>();
      const handed = await claimed.get(id)!.runner.element(id, values, { message, conversation, talk, signal });
      for (const [data, uri] of absent) {
        if (!existsSync(path.join(dir, uri))) continue;
        keep({ event: 'imported', id: data, uri, at: timelineTimestamp() });
        note('artifact.staged', `    ▤ stage ${uri}  ${humanBytes(statSync(path.join(dir, uri)).size)}`);
      }
      return handed;
    },
    log: log.event,
    now: () => timelineTimestamp(),
    get reuse() { return made.records; },
    record: keep,
    outputs: (_id, targets, _entry, note: Note) => {
      for (const target of targets) {
        const uri = made.walk.graph.uriOf(target);
        if (!uri || !existsSync(path.join(dir, uri))) continue;
        keep({ event: 'created', id: target, uri, at: timelineTimestamp() });
        note('artifact.saved', `    ▤ save ${uri}  ${humanBytes(statSync(path.join(dir, uri)).size)}`);
      }
    },
    // --debug: every element leaves `<id>.state.json` in `.cache/`: the run's values once it is done, with its
    // `result` and `durationMs` beside them.
    passed: !run.debug ? undefined : (id) => {
      const values = made.walk.jsonValues();
      const entry: Entry | undefined = made.walk.steps.entries.findLast((candidate) => candidate.node === id);
      if (entry) {
        const generated = (entry.generated as string[] | undefined) ?? [];
        const result = made.walk.values.has(id) ? made.walk.values.get(id)
          : generated.length > 0 ? made.walk.values.get(generated[0]) : (entry.taken as { sequenceFlow?: string } | undefined)?.sequenceFlow;
        if (result !== undefined) values.result = result;
        if (entry.durationMs !== undefined) values.durationMs = entry.durationMs;
      }
      mkdirSync(cache, { recursive: true });
      writeFileSync(path.join(cache, `${id}.state.json`), JSON.stringify(values));
    },
  };
  const walk = made.walk = new Walk(plan, host, { seed, state });
  // A data store a step that never skips writes (a trial log each subject appends to) starts as it was when the run
  // this one redoes started, or goes when it did not exist then: what the redone steps appended, they append again.
  const appended = new Set([...(redone ? walk.live : [])].flatMap((id) => (plan.elements[id]?.outputs ?? [])
    .flatMap(({ target }) => (target && plan.elements[target]?.type === 'dataStoreReference' ? walk.graph.uriOf(target) ?? [] : []))));
  for (const uri of appended) {
    if (!repo.restore(uri, redone)) rmSync(path.join(dir, uri), { force: true });
    log.event('artifact.restored', `  ▤ ${uri}, as it was when the run this one redoes started`, { level: 'debug' });
  }
  made.records = new Records({
    graph: walk.graph, prior, repo, dir, sources, drawnAt,
    drawn: (id) => drawn(index.walked.get(id)!.element),
  });

  // The trailers of a commit that stamps no element are the document stamp's own attributes.
  const trailers = { 'Prov-Action': 'executed', 'Prov-When': startedAt, 'Prov-Who': who, 'Prov-With': run.tool, 'Prov-Run': runId, 'Prov-Seed': seed };
  const studyId = index.root.id ?? '';
  keep({ event: 'started', at: startedAt, run: runId, state: structuredClone(state), stamp: timeline });
  repo.commit(`started ${studyId} (${stamp})`, trailers, startedAt);
  const begun = repo.head();
  log.event('run.started', plan.study.name ?? studyId);
  log.event('run.started', `  [${studyId}]  plan ${run.digest}  rootSeed ${seed}  repo ${dir}`, { level: 'debug' });

  const stop = (): void => walk.abort(new Error('stopped by the person running it'));
  process.once('SIGINT', stop);
  try {
    await walk.run();
  } catch (error) {
    log.event('run.failed', `  ${(error as Error)?.name ?? 'Error'}: ${(error as Error)?.message ?? error}`, { level: 'error' }, (error as Error)?.stack);
    walk.steps.status = 'error';
  } finally {
    process.off('SIGINT', stop);
  }
  // The runners end before the cache they were given goes.
  await Promise.all(runners.map((runner) => runner.shutdown()));

  // Skipped steps keep the record of the run that did the work. A branching run supersedes work records instead of
  // replacing them (the first branch's stay, so the trail shows both branches), and start and end events supersede
  // too, so a replay walks every run end to end. Only containers always replace in place, and `reused` lines: the
  // trail carries each element's latest reuse only.
  const replaces = (action: string, id: string): string | undefined =>
    (!branched || action === 'reused' || CONTAINER_TYPES.has(plan.elements[id]?.type) ? action : undefined);
  const head = repo.head();
  // The commit a step's record points at: what it ran with, and what it made, as git holds them.
  const commits = repo.executedSince(begun);
  // What the study keeps of the run is read off its record: the state it leaves, and each element's record.
  const { executed, decided, created, imported, reused } = recordOf(events);
  const stamps: [id: string, action: string, extra: Stamp][] = [
    // An event leaves no commit of its own: its record points at where the run had reached by the end.
    ...[...executed.keys()].sort().map((id): [string, string, Stamp] => [id, 'executed', { commit: commits.get(id) || head }]),
    ...[...decided].sort().map(([id, { flow }]): [string, string, Stamp] => [id, 'executed', { what: flow, commit: commits.get(id) }]),
    ...[...created.keys()].sort().map((id): [string, string, Stamp] => [id, 'created', {}]),
    ...[...imported.keys()].sort().map((id): [string, string, Stamp] => [id, 'imported', {}]),
    ...[...reused].sort().map(([id, { trusted }]): [string, string, Stamp] => [id, 'reused', { what: trusted }]),
  ];
  const moments = new Map<string, string>([
    ...imported, ...executed, ...created,
    ...[...decided].map(([id, { when }]): [string, string] => [id, when]),
    ...[...reused].map(([id, { when }]): [string, string] => [id, when]),
  ]);
  writeState(definitions, moddle, stateOf(events));
  for (const [id, action, extra] of stamps) {
    const element = index.walked.get(id)?.element;
    if (element) stampElement(moddle, element, { action, when: moments.get(id), run: runId, ...extra }, replaces(action, id));
  }
  await run.write(definitions, archive);
  log.event('diagram.archived', `  → ${archive}`, { level: 'debug' });

  if (!run.debug) rmSync(cache, { recursive: true, force: true });
  const { status } = walk.steps;
  log.event('run.finished', `  → ${dir}/ (${status}) in ${(Date.now() - started.getTime()).toFixed(1)}ms`, { level: status === 'ok' ? 'info' : 'error' });
  keep({ event: 'finished', at: timelineTimestamp(), status });
  repo.commit(`finished ${studyId} (${status})`, trailers, timelineTimestamp());
  repo.tidy();
  return status === 'ok' ? 0 : 1;
}
