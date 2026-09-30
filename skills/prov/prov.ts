/**
 * The prov skill's module: the run repository and the prov timeline. The local runtime (skills/local) keeps every run
 * in a git repository through {@link RunRepo}, and stamps what it did on the study's elements as `prov:Activity`
 * entries (prov.moddle.yaml), which the next run reads back as its records.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';

import type { Moddle, ModdleElement } from '@core/element/moddle';

export type Log = (event: string, message: string, detail?: { level?: 'debug' | 'info' | 'warning' | 'error' }) => void;

const ACTIVITY = 'prov:Activity';

/** The fields of a record, in the order they are written. */
export const TIMELINE_FIELDS = ['action', 'when', 'who', 'with', 'what', 'run', 'seed', 'plan', 'commit', 'note'] as const;

export type Stamp = Partial<Record<(typeof TIMELINE_FIELDS)[number], string | number | undefined>>;

/** A step's standing record: the run that did it, when, what it decided, and the commit holding it as it ran. */
export type ElementRecord = { run: string; when: string; what?: string; commit?: string };

export function currentUser(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}

const activitiesOf = (element: ModdleElement): ModdleElement[] =>
  (element.extensionElements?.values ?? []).filter((value: ModdleElement) => value.$type === ACTIVITY);

/** An element's `executed` entries in document (chronological) order, and its `invalidated` markers. */
function timelineOf(element: ModdleElement): { executed: ElementRecord[]; markers: { run?: string; what?: string }[] } {
  const executed: ElementRecord[] = [];
  const markers: { run?: string; what?: string }[] = [];
  for (const entry of activitiesOf(element)) {
    if (entry.action === 'executed' && entry.run) executed.push({ run: entry.run, when: entry.when, what: entry.what, commit: entry.commit });
    else if (entry.action === 'invalidated') markers.push({ run: entry.run, what: entry.what });
  }
  return { executed, markers };
}

/**
 * Each element's standing `executed` record: the newest, unless voided. A marker voids by exact `when` (its `what`),
 * or, lacking a `what`, coarsely by run, a standing re-run pin. Older entries a branching run superseded are the first
 * branch's history and never stand.
 */
export function elementRecords(elements: Iterable<ModdleElement>): Map<string, ElementRecord> {
  const records = new Map<string, ElementRecord>();
  for (const element of elements) {
    const { executed, markers } = timelineOf(element);
    const newest = executed.at(-1);
    if (!newest) continue;
    const voided = markers.some(({ run, what }) => (what ? what === newest.when : !run || run === newest.run));
    if (!voided) records.set(element.id, newest);
  }
  return records;
}

/** Elements whose marker names the newest record (`what` is its `when`); only these branch. Coarse markers without a
 * `what` re-run their step in place and never branch. */
export function invalidatedElements(elements: Iterable<ModdleElement>): string[] {
  const marked: string[] = [];
  for (const element of elements) {
    const { executed, markers } = timelineOf(element);
    const newest = executed.at(-1)?.when;
    if (newest && markers.some(({ what }) => what && what === newest)) marked.push(element.id);
  }
  return marked;
}

/** Appends a record to the element's timeline. Only the same-action entries `replace` names are dropped first;
 * `invalidated` markers are history and are never deleted. */
export function stampElement(moddle: Moddle, element: ModdleElement, stamp: Stamp, replace?: string): void {
  let holder = element.extensionElements;
  if (!holder) {
    holder = moddle.create('bpmn:ExtensionElements', { values: [] });
    holder.$parent = element;
    element.extensionElements = holder;
  }
  const values: ModdleElement[] = holder.get('values');
  if (replace) {
    for (let i = values.length - 1; i >= 0; i -= 1) {
      if (values[i].$type === ACTIVITY && values[i].action === replace) values.splice(i, 1);
    }
  }
  const fields = Object.fromEntries(TIMELINE_FIELDS.flatMap((name) => (stamp[name] ? [[name, stamp[name]]] : [])));
  const entry = moddle.create(ACTIVITY, fields);
  entry.$parent = holder;
  values.push(entry);
}

/**
 * The run directory as a git repository. Replication never fails a run: git trouble degrades to a no-op.
 */
export class RunRepo {
  /** An inherited GIT_DIR would aim every command at the caller's repository instead of this one. */
  private static readonly SCRUBBED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];
  private static readonly LFS_PATTERNS = ['*.joblib', '*.parquet', '*.png', '*.svg', '*.pdf'];
  /** How a checkpoint commits. No housekeeping: git starts it in the background after a commit, and a repack beside
   * checkpoints that come tens of milliseconds apart loses commits (`tidy` does it once, at the end). */
  private static readonly CHECKPOINT = ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false'];

  readonly dir: string;
  created = false;
  private enabled: boolean;
  private readonly lfs: boolean;
  private readonly env: NodeJS.ProcessEnv;
  private readonly log: Log;

  constructor(directory: string, log: Log) {
    this.dir = directory;
    this.log = log;
    this.enabled = onPath('git');
    this.lfs = this.enabled && onPath('git-lfs');
    this.env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !RunRepo.SCRUBBED.includes(key)));
    if (!this.enabled) log('git.unavailable', '  no git on PATH — this run directory stays a plain folder', { level: 'warning' });
    else if (!this.lfs) log('git.lfs.unavailable', '  no git-lfs on PATH — artifacts are committed as plain blobs', { level: 'warning' });
  }

  /** Without a `.git` of its own the directory belongs to whatever repository contains it; never touch that. */
  get active(): boolean {
    return this.enabled && existsSync(path.join(this.dir, '.git'));
  }

  /** `tolerate` is for calls whose failure is an answer (no such ref), not a broken git; `raw` ones create the repo. */
  private git(args: string[], options: { tolerate?: boolean; when?: string; raw?: boolean; binary?: boolean } = {}): { ok: boolean; out: string; bytes?: Buffer } | undefined {
    if (!this.enabled || !(options.raw || this.active)) return undefined;
    const env = { ...this.env, ...(options.when ? { GIT_AUTHOR_DATE: options.when, GIT_COMMITTER_DATE: options.when } : {}) };
    const done = spawnSync('git', ['-C', this.dir, ...args], { env, timeout: 60_000, maxBuffer: 1 << 28 });
    if (done.error) {
      this.degrade(`git ${args[0]}: ${done.error.message}`);
      return undefined;
    }
    if (done.status !== 0 && !options.tolerate) {
      const detail = (done.stderr.toString() || done.stdout.toString()).trim().split('\n');
      this.degrade(`git ${args[0]} exited ${done.status}: ${detail[0] ?? ''}`);
      return undefined;
    }
    return { ok: done.status === 0, out: done.stdout.toString(), bytes: options.binary ? done.stdout : undefined };
  }

  private degrade(reason: string): void {
    this.enabled = false;
    this.log('git.failed', `  ${reason} — the rest of this run is not replicated into git`, { level: 'warning' });
  }

  /** Init the directory, or adopt one a git-less run left; either way the next commit baselines it. */
  open(): void {
    if (!this.enabled) return;
    if (existsSync(path.join(this.dir, '.git'))) {
      this.excludeCache();
      return;
    }
    if (!this.git(['-c', 'init.defaultBranch=main', 'init', '-q'], { raw: true })) return;
    this.created = true;
    this.excludeCache();
    const who = currentUser() || 'studyflow-runner';
    this.git(['config', 'user.name', who]);
    // RFC 2606's reserved TLD: an address git accepts and no mail ever leaves for.
    this.git(['config', 'user.email', `${who}@studyflow.invalid`]);
    // A signing key the runner cannot unlock would fail every commit; provenance here is the history itself.
    this.git(['config', 'commit.gpgsign', 'false']);
    if (this.lfs) {
      // The filter has to be installed before `.gitattributes` declares it, or every later `add` fails.
      this.git(['lfs', 'install', '--local']);
      writeFileSync(path.join(this.dir, '.gitattributes'), RunRepo.LFS_PATTERNS.map((pattern) => `${pattern} filter=lfs diff=lfs merge=lfs -text\n`).join(''));
    }
    this.log('git.init', `  → ${this.dir}/.git`, { level: 'debug' });
  }

  /** `.cache/` is transient hand-off state for partial runners; it never enters the history. */
  private excludeCache(): void {
    const info = path.join(this.dir, '.git', 'info');
    if (!existsSync(info)) mkdirSync(info, { recursive: true });
    const exclude = path.join(info, 'exclude');
    const marks = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    if (!marks.includes('.cache/')) writeFileSync(exclude, `${marks}.cache/\n`);
  }

  /** One checkpoint: whatever the step wrote, plus the log lines, with its record entries as the body. */
  commit(subject: string, trailers: Record<string, string | number | null | undefined> = {}, when?: string, body?: string): void {
    const lines = Object.entries(trailers).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => `${key}: ${value}`);
    // Trailers must be the message's last block, so the body sits between subject and trailers.
    const message = [subject, body, lines.join('\n')].filter(Boolean).join('\n\n');
    if (!this.git(['add', '-A'])) return;
    this.git([...RunRepo.CHECKPOINT, 'commit', '-q', '--allow-empty', '-m', message], { when });
  }

  /** Packs what the run left loose, now that nothing else writes: the housekeeping its checkpoints put off. A run of
   * a few steps leaves too little to be worth it. */
  tidy(): void {
    this.git(['-c', 'gc.auto=256', '-c', 'gc.autoDetach=false', 'gc', '--auto', '--quiet'], { tolerate: true });
  }

  /** The newest commit that executed this element; skips near the tip are not where its work entered. */
  commitForNode(id: string): string | undefined {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const done = this.git(['log', '-1', '--format=%H', '--all-match', `--grep=^Prov-Node: ${escaped}$`, '--grep=^Prov-Action: executed$'], { tolerate: true });
    return done?.ok ? done.out.trim().split('\n')[0] || undefined : undefined;
  }

  /** The commit just made: what a step's record points at. */
  head(): string {
    const done = this.git(['rev-parse', 'HEAD'], { tolerate: true });
    return done?.ok ? done.out.trim() : '';
  }

  /** Whether any of `paths` differs from what `commit` holds — git's own object hashes, not ours. */
  changedSince(commit: string, paths: string[]): boolean {
    const done = this.git(['diff', '--quiet', commit, '--', ...paths], { tolerate: true });
    return !done?.ok;
  }

  /** One file as `commit` holds it; undefined when that commit has no such file. */
  fileAt(commit: string, file: string): Buffer | undefined {
    const done = this.git(['show', `${commit}:${file}`], { tolerate: true, binary: true });
    return done?.ok ? done.bytes : undefined;
  }

  /** Put an artifact back from the commit that made it: the history is this runtime's cache. A checkout, not `show`,
   * so an LFS pointer comes back as its file. */
  restore(uri: string, commit: string | undefined): boolean {
    if (!commit) return false;
    const done = this.git(['checkout', commit, '--', uri], { tolerate: true });
    return !!done?.ok && existsSync(path.join(this.dir, uri));
  }

  /** `<element> <when>` of every step the checked-out history executed, read from its commits' trailers. */
  executed(): Set<string> {
    // A `separator` drops the line feed each trailer value otherwise ends with.
    const done = this.git(['log', '--format=%(trailers:key=Prov-Node,valueonly,separator=)%x09%(trailers:key=Prov-When,valueonly,separator=)', '--grep=^Prov-Action: executed$'], { tolerate: true });
    if (!done?.ok) return new Set();
    return new Set(done.out.split('\n').filter((line) => line.split('\t')[0]).map((line) => line.split('\t').join(' ')));
  }

  isAncestor(commit: string, other: string): boolean {
    return !!this.git(['merge-base', '--is-ancestor', commit, other], { tolerate: true })?.ok;
  }

  /** Checking a branch point out is the re-run: what was made after it leaves the worktree with it. No commit means a
   * branch at HEAD, which checks nothing out. */
  branch(name: string, commit?: string): boolean {
    // --discard-changes: what stands in the checkout's way is this run's own truncated log.
    const done = this.git(commit ? ['switch', '--discard-changes', '-c', name, commit] : ['switch', '-c', name], { tolerate: true });
    if (done && !done.ok) this.log('git.branch.failed', `  switch -c ${name} failed`, { level: 'warning' });
    return !!done?.ok;
  }

  /** Empty means a detached HEAD; a branch with no commits yet still answers with its name. */
  currentBranch(): string {
    const done = this.git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { tolerate: true });
    return done?.ok ? done.out.trim() : '';
  }

  /** `studyflow.log` and the journal are left out: every run writes them, which is not an edit from outside. */
  dirty(): boolean {
    const done = this.git(['status', '--porcelain', '--', '.', ':(exclude)studyflow.log', ':(exclude)run.jsonl']);
    return !!done?.out.trim();
  }
}

/** Where a re-run branches: `--from`'s own commit, else the furthest back of the invalidated elements'. */
export function branchPoint(repo: RunRepo, invalidated: string[], from: string | undefined): string | undefined {
  if (from) return from;
  let earliest: string | undefined;
  for (const id of invalidated) {
    const commit = repo.commitForNode(id);
    if (commit && (!earliest || repo.isAncestor(commit, earliest))) earliest = commit;
  }
  return earliest;
}

function onPath(binary: string): boolean {
  try {
    execFileSync(binary, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
