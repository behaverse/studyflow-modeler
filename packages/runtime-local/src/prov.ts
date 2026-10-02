/**
 * The run repository and the prov timeline. The local runtime keeps every run in a git repository through
 * {@link RunRepo}, and stamps what it did on the study's elements as `prov:Activity` entries
 * (skills/studyflow/prov.moddle.yaml), which the next run reads back as its records.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { devNull } from 'node:os';
import path from 'node:path';

import { isElement, type Element } from '@core/model/index';

export type Log = (event: string, message: string, detail?: { level?: 'debug' | 'info' | 'warning' | 'error' }) => void;

const ACTIVITY = 'prov:Activity';

/** The fields of a record, in the order they are written. */
export const TIMELINE_FIELDS = ['action', 'when', 'who', 'with', 'what', 'run', 'seed', 'allocationSeed', 'plan', 'commit', 'note'] as const;

export type Stamp = Partial<Record<(typeof TIMELINE_FIELDS)[number], string | number | undefined>>;

/** A step's standing record: the run that did it, when, what it decided, and the commit holding it as it ran. */
export type ElementRecord = { run: string; when: string; what?: string; commit?: string };

/** Who ran a study, as git writes an author: `Name <email>`, the email optional (empty). */
export type Author = { name: string; email: string };

/** Whom a run's commits name when it is given no author: no one, never this machine's user. RFC 2606's reserved TLD
 * gives an address git accepts and no mail ever leaves for. */
const NO_AUTHOR: Author = { name: 'studyflow-runner', email: 'studyflow-runner@studyflow.invalid' };

/** `--author`'s text, `Name <email>` or a name alone. */
export function authorOf(given: string): Author {
  const match = /^(.*?)\s*<([^<>]*)>\s*$/.exec(given);
  const name = (match ? match[1] : given).trim();
  if (!name || /[<>]/.test(name)) throw new Error(`--author wants 'Name <email>' or a name alone, got '${given}'`);
  return { name, email: match ? match[2].trim() : '' };
}

/** An author as a record names them (`who`, `Prov-Who`): as git writes them, or the name alone. */
export const signature = ({ name, email }: Author): string => (email ? `${name} <${email}>` : name);

/** What a run that keeps its data out of the history (`--data-outside-history`) commits in the data's place: the SHA-256
 * of each file the history leaves out, in `sha256sum`'s format, so `sha256sum -c data.sha256` checks a run directory. */
export const MANIFEST = 'data.sha256';

/** What the `.gitignore` of such a repository says first, to whoever opens it. */
const KEPT_OUT = [
  '# studyflow run --data-outside-history: this history holds the study as run and data.sha256, the SHA-256 of every',
  '# other file here, which stays in this directory alone.',
  '/*',
];

const manifestOf = (text: string): Map<string, string> => new Map(text.split('\n').flatMap((line) => {
  const entry = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
  return entry ? [[entry[2], entry[1]] as [string, string]] : [];
}));

/** The digests of `uri`, a file or a folder, as one text: equal texts, the same files with the same content. */
function digestsAt(digests: Map<string, string>, uri: string): string {
  const at = path.posix.normalize(uri).replace(/\/$/, '');
  return [...digests].filter(([name]) => name === at || name.startsWith(`${at}/`)).sort().join('\n');
}

/** A file the history keeps out that a run needs as an earlier commit left it, and which is not: the run stops. */
export class KeptOutOfHistory extends Error {}

const activitiesOf = (element: Element): Element[] =>
  (Array.isArray(element.extensionElements) ? element.extensionElements : []).filter((value): value is Element => isElement(value) && value.type === ACTIVITY);

const text = (value: unknown): string | undefined => (value === undefined || value === null ? undefined : String(value));

/** An element's `executed` entries in document (chronological) order, and its `invalidated` markers. */
function timelineOf(element: Element): { executed: ElementRecord[]; markers: { run?: string; what?: string }[] } {
  const executed: ElementRecord[] = [];
  const markers: { run?: string; what?: string }[] = [];
  for (const entry of activitiesOf(element)) {
    if (entry.action === 'executed' && entry.run) executed.push({ run: text(entry.run)!, when: text(entry.when)!, what: text(entry.what), commit: text(entry.commit) });
    else if (entry.action === 'invalidated') markers.push({ run: text(entry.run), what: text(entry.what) });
  }
  return { executed, markers };
}

/**
 * Each element's standing `executed` record: the newest, unless voided. A marker voids by exact `when` (its `what`),
 * or, lacking a `what`, coarsely by run, a standing re-run pin. Older entries a branching run superseded are the first
 * branch's history and never stand.
 */
export function elementRecords(elements: Iterable<Element>): Map<string, ElementRecord> {
  const records = new Map<string, ElementRecord>();
  for (const element of elements) {
    const { executed, markers } = timelineOf(element);
    const newest = executed.at(-1);
    if (!newest) continue;
    const voided = markers.some(({ run, what }) => (what ? what === newest.when : !run || run === newest.run));
    if (!voided && element.id) records.set(element.id, newest);
  }
  return records;
}

/** Elements whose marker names the newest record (`what` is its `when`); only these branch. Coarse markers without a
 * `what` re-run their step in place and never branch. */
export function invalidatedElements(elements: Iterable<Element>): string[] {
  const marked: string[] = [];
  for (const element of elements) {
    const { executed, markers } = timelineOf(element);
    const newest = executed.at(-1)?.when;
    if (newest && element.id && markers.some(({ what }) => what && what === newest)) marked.push(element.id);
  }
  return marked;
}

/** Appends a record to the element's timeline. Only the same-action entries `replace` names are dropped first;
 * `invalidated` markers are history and are never deleted. */
export function stampElement(element: Element, stamp: Stamp, replace?: string): void {
  const values = Array.isArray(element.extensionElements) ? element.extensionElements : (element.extensionElements = []);
  if (replace) {
    for (let i = values.length - 1; i >= 0; i -= 1) {
      const value = values[i];
      if (isElement(value) && value.type === ACTIVITY && value.action === replace) values.splice(i, 1);
    }
  }
  values.push({ type: ACTIVITY, ...Object.fromEntries(TIMELINE_FIELDS.flatMap((name) => (stamp[name] ? [[name, stamp[name]]] : []))) });
}

/**
 * The run directory as a git repository. Replication never fails a run: git trouble degrades to a no-op. What stops
 * one is a repository that keeps its data out of its history and cannot keep its word: asked of a history that holds
 * data already ({@link keepDataOut}), or to put back a file it holds only the digest of ({@link restore}).
 */
export class RunRepo {
  /** An inherited GIT_DIR would aim every command at the caller's repository instead of this one. */
  private static readonly SCRUBBED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];
  private static readonly LFS_PATTERNS = ['*.joblib', '*.parquet', '*.png', '*.svg', '*.pdf'];
  /** What every run writes about itself: its record (`events.jsonl`) and its log. */
  private static readonly ACCOUNTS = ['events.jsonl', 'studyflow.log'];
  /**
   * How a checkpoint commits. No housekeeping: git starts it in the background after a commit, and a repack beside
   * checkpoints that come tens of milliseconds apart loses commits (`tidy` does it once, at the end). No hooks: LFS
   * stores a file through its filter, at `add`; its post-commit hook only tends file locks, which a run repository
   * has none of, and costs more than the commit.
   */
  private static readonly CHECKPOINT = ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', `core.hooksPath=${devNull}`];

  readonly dir: string;
  created = false;
  /** Whether the history keeps the run's data out ({@link keepDataOut}). */
  private outside = false;
  private enabled: boolean;
  private readonly lfs: boolean;
  private readonly env: NodeJS.ProcessEnv;
  private readonly log: Log;

  /** `author` is whom every commit names, as author and committer; git's own identity, from its config, never fills in. */
  constructor(directory: string, log: Log, author: Author = NO_AUTHOR) {
    this.dir = directory;
    this.log = log;
    this.enabled = onPath('git');
    this.lfs = this.enabled && onPath('git-lfs');
    this.env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !RunRepo.SCRUBBED.includes(key))),
      GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email,
    };
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

  /**
   * Keeps the run's data out of the history when `asked` (`--data-outside-history`), and in a repository whose history
   * holds the manifest, asked or not. Its commits then hold `study`, the study as run, and the manifest; every other
   * file in the run directory stays there alone, and a `.gitignore` says so, to git and to whoever opens the
   * repository. A history that holds data already cannot give it back, so asking there is refused.
   */
  keepDataOut(study: string, asked: boolean): void {
    if (!this.active) return;
    const kept = this.fileAt('HEAD', MANIFEST) !== undefined;
    if (!kept && !asked) return;
    if (!kept && this.head()) {
      throw new Error(`${this.dir} holds its data in its history already: --data-outside-history keeps it out of a run repository from its first commit. Run into a new --repo.`);
    }
    this.outside = true;
    const ignore = path.join(this.dir, '.gitignore');
    const listed = existsSync(ignore) ? readFileSync(ignore, 'utf8').split('\n').filter((line) => line.startsWith('!/')) : [];
    const committed = ['.gitignore', '.gitattributes', MANIFEST, study].map((name) => `!/${name.replace(/[*?[\\]/g, '\\$&')}`);
    writeFileSync(ignore, `${[...KEPT_OUT, ...new Set([...listed, ...committed])].join('\n')}\n`);
  }

  /** The SHA-256 of each file under `paths` the history keeps out, by its path in the run directory; `.cache/`, which
   * no commit holds either way, aside. */
  private digests(paths: string[], except: readonly string[] = []): Map<string, string> {
    const listed = this.git(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', ...paths]);
    const found = new Map<string, string>();
    for (const name of listed?.out.split('\0') ?? []) {
      if (!name || name.startsWith('.cache/') || except.includes(name)) continue;
      try {
        found.set(name, createHash('sha256').update(readFileSync(path.join(this.dir, name))).digest('hex'));
      } catch { /* removed since it was listed, by a runner still at work */ }
    }
    return found;
  }

  /** The digests the manifest at `commit` holds. */
  private manifestAt(commit: string): Map<string, string> {
    return manifestOf(this.fileAt(commit, MANIFEST)?.toString('utf8') ?? '');
  }

  /** Writes the manifest of the files the history keeps out. Without `accounts` the record and the log keep the lines
   * the last commit gave them, as a checkpoint commits neither. */
  private writeManifest(accounts: boolean): void {
    const file = path.join(this.dir, MANIFEST);
    const digests = this.digests(['.'], accounts ? [] : RunRepo.ACCOUNTS);
    const before = accounts || !existsSync(file) ? new Map<string, string>() : manifestOf(readFileSync(file, 'utf8'));
    for (const account of RunRepo.ACCOUNTS) if (before.has(account)) digests.set(account, before.get(account)!);
    writeFileSync(file, [...digests].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, digest]) => `${digest}  ${name}\n`).join(''));
  }

  /** A commit of everything in the run directory: a run's `started` and `finished`, an edit made outside a run. */
  commit(subject: string, trailers: Record<string, string | number | null | undefined> = {}, when?: string): void {
    this.commitWith(true, subject, trailers, when);
  }

  /** One step's checkpoint: whatever the step wrote, without the run's record and log, which grow with every step and
   * are committed with the run's `started` and `finished` commits. */
  checkpoint(subject: string, trailers: Record<string, string | number | null | undefined> = {}, when?: string): void {
    this.commitWith(false, subject, trailers, when);
  }

  private commitWith(accounts: boolean, subject: string, trailers: Record<string, string | number | null | undefined>, when?: string): void {
    const lines = Object.entries(trailers).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => `${key}: ${value}`);
    // Trailers must be the message's last block.
    const message = [subject, lines.join('\n')].filter(Boolean).join('\n\n');
    if (this.outside) this.writeManifest(accounts);
    // Kept out, the record and the log need no excluding, and `add` refuses to be told of a file it ignores.
    const excluded = accounts || this.outside ? [] : RunRepo.ACCOUNTS.map((file) => `:(exclude)${file}`);
    if (!this.git(['add', '-A', '--', '.', ...excluded])) return;
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

  /** The newest run's `started` commit in the checked-out history, if a run has started in it. */
  lastStarted(): string | undefined {
    const done = this.git(['log', '-1', '--format=%H', '--grep=^started '], { tolerate: true });
    return done?.ok ? done.out.trim() || undefined : undefined;
  }

  /** The commit the history is at. */
  head(): string {
    const done = this.git(['rev-parse', 'HEAD'], { tolerate: true });
    return done?.ok ? done.out.trim() : '';
  }

  /** Whether any of `paths` differs from what `commit` holds — git's own object hashes, not ours; a file the history
   * keeps out, from the SHA-256 the commit's manifest holds. */
  changedSince(commit: string, paths: string[]): boolean {
    const done = this.git(['diff', '--quiet', commit, '--', ...paths], { tolerate: true });
    if (!done?.ok) return true;
    if (!this.outside) return false;
    const then = this.manifestAt(commit);
    const now = this.digests(paths);
    return paths.some((uri) => digestsAt(then, uri) !== digestsAt(now, uri));
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
    if (this.outside) {
      // The history holds a digest, not the file: one still as the commit left it stands, and one that is not stops the
      // run rather than let a step run on something else.
      const then = digestsAt(this.manifestAt(commit), uri);
      if (!then) return false;
      if (then === digestsAt(this.digests([uri]), uri)) return true;
      throw new KeptOutOfHistory(`${uri} is not as ${commit.slice(0, 8)} left it, and this run repository keeps its data out of its history: `
        + `${MANIFEST} there holds the file's SHA-256, not the file. Put it back as it was.`);
    }
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

  /** The commit that last executed each element since `commit`: what a step's record points at. */
  executedSince(commit: string): Map<string, string> {
    const found = new Map<string, string>();
    if (!commit) return found;
    const done = this.git(['log', `${commit}..HEAD`, '--format=%H%x09%(trailers:key=Prov-Node,valueonly,separator=)', '--grep=^Prov-Action: executed$'], { tolerate: true });
    for (const line of done?.ok ? done.out.split('\n') : []) {
      const [hash, node] = line.split('\t');
      if (node && !found.has(node)) found.set(node, hash); // newest first
    }
    return found;
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

  /** `studyflow.log` and the journal are left out: every run writes them, which is not an edit from outside. A file the
   * history keeps out shows as the manifest, written first. */
  dirty(): boolean {
    if (this.outside) this.writeManifest(false);
    const done = this.git(['status', '--porcelain', '--', '.', ...RunRepo.ACCOUNTS.map((file) => `:(exclude)${file}`)]);
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
