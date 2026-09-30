import { execFile, spawn } from 'node:child_process';
import { accessSync, appendFileSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { PROTOCOL, type Talk } from '@core/engine';
import { parseSkillManifest } from '@core/notation/skill';
import type { RunLog } from '@skills/local/src/log';

/** A command line as a shell would split it: quotes group, a backslash escapes. */
export function shellWords(command: string): string[] {
  const words: string[] = [];
  let word = '';
  let quote = '';
  let open = false;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = '';
      else if (char === '\\' && quote === '"' && i + 1 < command.length) word += command[i += 1];
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      open = true;
    } else if (char === '\\' && i + 1 < command.length) {
      word += command[i += 1];
      open = true;
    } else if (/\s/.test(char)) {
      if (word || open) words.push(word);
      word = '';
      open = false;
    } else {
      word += char;
      open = true;
    }
  }
  if (word || open) words.push(word);
  return words;
}

/** A word a shell reads back as it is. */
function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Every skill folder (one with a `SKILL.md`) under each of `roots` (the checkout's `skills/`, or `libexec/skills` as
 * installed), then the skills installed with `studyflow skill add` (`$STUDYFLOW_HOME/skills`, `~/.studyflow/skills`),
 * then under each `STUDYFLOW_SKILLS` directory. A name found twice is the first one's.
 */
export function skillDirs(roots: string[]): string[] {
  const installed = path.join(process.env.STUDYFLOW_HOME || path.join(homedir(), '.studyflow'), 'skills');
  const extra = (process.env.STUDYFLOW_SKILLS ?? '').split(path.delimiter).filter(Boolean);
  const found = new Map<string, string>();
  for (const root of [...roots, installed, ...extra]) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root).sort()) {
      if (!found.has(name) && existsSync(path.join(root, name, 'SKILL.md'))) found.set(name, path.join(root, name));
    }
  }
  return [...found.values()].sort();
}

export type RunnerCommand = { command: string; cwd?: string };

/**
 * Partial runners in reach, by name, each claiming its own elements: every skill whose `SKILL.md` declares a
 * `runtimes.local` command (run in the skill's folder), a `studyflow-<name>` on PATH, then `STUDYFLOW_<NAME>_PY`
 * overrides. The study's `dependencies` join every uv script's environment (`uv run --with`); anything else brings
 * its own.
 */
export function discoverRunners(roots: string[], dependencies: string[]): Map<string, RunnerCommand> {
  const withs = dependencies.map((dependency) => ` --with ${shellQuote(dependency)}`).join('');
  const found = new Map<string, RunnerCommand>();
  for (const folder of skillDirs(roots)) {
    let command = parseSkillManifest(readFileSync(path.join(folder, 'SKILL.md'), 'utf8')).runtimes?.local;
    if (!command) continue; // a vocabulary alone, or nothing for this runtime
    if (withs && command.startsWith('uv run')) command = `uv run${withs}${command.slice('uv run'.length)}`;
    found.set(path.basename(folder).toLowerCase(), { command, cwd: folder });
  }
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    let entries: string[];
    try {
      entries = readdirSync(directory || '.');
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith('studyflow-') || entry.includes('.')) continue;
      const name = entry.slice('studyflow-'.length).toLowerCase();
      try {
        accessSync(path.join(directory, entry), constants.X_OK);
      } catch {
        continue;
      }
      if (!['run', 'run-local', 'prov'].includes(name)) found.set(name, { command: shellQuote(path.join(directory, entry)) });
    }
  }
  for (const [key, value] of Object.entries(process.env)) {
    const matched = /^STUDYFLOW_([A-Z0-9_]+)_PY$/.exec(key);
    const name = matched?.[1].toLowerCase().replaceAll('_', '-');
    if (name && value && !['run', 'run-local', 'prov'].includes(name)) found.set(name, { command: `uv run${withs} --script ${shellQuote(value)}` });
  }
  return found;
}

export type Claims = { elements: string[]; live: boolean };

/**
 * A partial runner as a subprocess per element: `COMMAND <plan.json> --element <id> --cache <dir>`. It runs the
 * elements it claims (`COMMAND <plan.json> --claims` answers with their ids), whatever they are. One file per
 * hand-off, `<id>.state.json` in the cache: the run's values go in, and come back with `result`, `durationMs`, and on
 * failure `error` merged in. The runner's stdout goes to the run log; stdin and stderr stay on the terminal.
 */
export class PartialRunner {
  readonly name: string;
  readonly argv: string[];
  private readonly cwd: string | undefined;
  private readonly plan: string;
  private readonly cache: string;
  private readonly log: RunLog;
  private readonly debug: boolean;
  /** Seconds a hand-off may take before it is stopped (`--step-timeout`). */
  private readonly timeout: number | undefined;

  constructor(name: string, { command, cwd }: RunnerCommand, repo: string, log: RunLog, options: { debug: boolean; timeout?: number }) {
    this.name = name;
    this.argv = shellWords(command);
    this.cwd = cwd;
    this.cache = path.join(repo, '.cache');
    this.plan = path.join(this.cache, 'plan.json');
    this.log = log;
    this.debug = options.debug;
    this.timeout = options.timeout;
  }

  /** The elements it will run; undefined when its command is not on this machine, so it claims none. */
  async claims(): Promise<Claims | undefined> {
    const done = await new Promise<{ error: (Error & { code?: unknown }) | null; stdout: string; stderr: string }>((resolve) => {
      execFile(this.argv[0], [...this.argv.slice(1), this.plan, '--claims'], { cwd: this.cwd, encoding: 'utf8' },
        (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
    if (done.error?.code === 'ENOENT') return undefined;
    const lines = done.stdout.split('\n').filter((line) => line.trim());
    if (done.error || lines.length === 0) {
      const detail = done.stderr.trim().split('\n');
      throw new Error(`${this.name} --claims failed: ${detail.at(-1) || done.error?.message || 'it answered nothing'}`);
    }
    const answer = JSON.parse(lines.at(-1)!);
    // A plain array marks its elements live; a runner may say which version of the contract it speaks.
    if (Array.isArray(answer)) return { elements: answer, live: true };
    if ((answer.protocol ?? PROTOCOL) !== PROTOCOL) {
      throw new Error(`${this.name} speaks hand-off protocol ${answer.protocol}; this walk speaks ${PROTOCOL}`);
    }
    return { elements: answer.elements ?? [], live: answer.live ?? true };
  }

  /** One hand-off. While the runner runs, each line it appends to `<id>.outbox.jsonl` goes along the flow it names,
   * and each message along a flow into the element is appended to `<id>.inbox.jsonl`. */
  async element(id: string, values: Record<string, unknown>, talk?: Talk, signal?: AbortSignal): Promise<Record<string, unknown>> {
    mkdirSync(this.cache, { recursive: true });
    const handoff = path.join(this.cache, `${id}.state.json`);
    writeFileSync(handoff, JSON.stringify(values));
    const outbox = path.join(this.cache, `${id}.outbox.jsonl`);
    const inbox = path.join(this.cache, `${id}.inbox.jsonl`);
    if (talk) for (const box of [outbox, inbox]) rmSync(box, { force: true });

    let done = 0;
    const carry = (): void => {
      const data = existsSync(outbox) ? readFileSync(outbox) : Buffer.alloc(0);
      const end = data.lastIndexOf('\n') + 1; // whole lines only: the runner may be writing the next one
      for (const line of data.subarray(done, end).toString('utf8').split('\n').filter((text) => text.trim())) {
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          message = { flow: line.slice(0, 80) };
        }
        talk!.send(message as Parameters<Talk['send']>[0]);
      }
      done = end;
      const due = talk!.take();
      if (due.length > 0) appendFileSync(inbox, due.map((message) => `${JSON.stringify(message)}\n`).join(''));
    };

    // The walk's own pid, so whatever a runner leaves running for the study can follow the walk; unbuffered, so a
    // Python runner's progress shows while it works, not when it is done.
    const child = spawn(this.argv[0], [...this.argv.slice(1), this.plan, '--element', id, '--cache', this.cache], {
      cwd: this.cwd,
      env: { ...process.env, STUDYFLOW_RUN_PID: String(process.pid), PYTHONUNBUFFERED: '1' },
      stdio: ['inherit', 'pipe', 'inherit'],
    });
    let timedOut = false;
    const timer = this.timeout ? setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, this.timeout * 1000) : undefined;
    // A timer at a boundary event ends the step: its runner is asked to stop.
    signal?.addEventListener('abort', () => child.kill('SIGTERM'));
    const pump = talk ? setInterval(carry, 50) : undefined;
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { // an element can take minutes (a robot seating itself): relay as it comes
      const lines = (pending + chunk).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) this.log.event('runner.stdout', `    ${line.trimEnd()}`);
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    }).finally(() => {
      clearTimeout(timer);
      clearInterval(pump);
    });
    if (pending.trim()) this.log.event('runner.stdout', `    ${pending.trimEnd()}`);
    if (talk) carry(); // one more pass after the runner exits, for what it wrote last

    const state = existsSync(handoff) ? JSON.parse(readFileSync(handoff, 'utf8')) : {};
    // Only the read state file goes; the cache survives the run (spilled values live there) and is swept at its end.
    if (!this.debug) rmSync(handoff, { force: true });
    if (timedOut) throw new Error(`${this.name}: ${id} took longer than ${this.timeout}s, and was stopped`);
    if (code !== 0 || state.error) throw new Error(`${this.name}: ${state.error || `exited with code ${code}`}`);
    return state;
  }
}
