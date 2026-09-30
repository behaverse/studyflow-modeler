import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createInterface as createPrompt } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

import { HandoffError, PROTOCOL, type Handback, type Message, type Talk } from '@core/engine';
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

/** How long a runner asked to stop a hand-off, or to shut down, has before its process is ended. */
const GRACE_MS = 2000;

type Process = ChildProcessByStdio<Writable, Readable, null>;

/** A JSON-RPC 2.0 message, one a line. */
type Rpc = { id?: string | number; method?: string; params?: Record<string, any>; result?: any; error?: { code?: number; message?: string; data?: unknown } };

/** What a runner answered a request with, when it answered with an error. */
class Refused extends Error {
  readonly data: unknown;

  constructor(message: string, data?: unknown) {
    super(message);
    this.data = data;
  }
}

/**
 * A partial runner: one process for the whole run, spoken to in JSON-RPC 2.0 on its stdin and stdout, one message a
 * line (SKILL.md, beside this folder, is the contract). `initialize` names the plan and the run and is answered with
 * the elements it takes; `execute` hands it one, and is answered with what it hands back; `message` and `cancel` reach
 * a hand-off while it runs; `shutdown` ends it. The runner sends `message` along a flow of the element it runs, `log`
 * for the run log, and asks `prompt` of the person at the walk's terminal. Its stderr stays on the terminal.
 */
export class PartialRunner {
  readonly name: string;
  readonly argv: string[];
  private readonly cwd: string | undefined;
  private readonly dir: string;
  private readonly log: RunLog;
  /** Seconds a hand-off may take before it is stopped (`--step-timeout`). */
  private readonly timeout: number | undefined;
  /** The local skill's folder, where a runner finds the SDK (`STUDYFLOW_LOCAL`). */
  private readonly local: string | undefined;
  private child: Process | undefined;
  private asked = 0;
  private readonly waiting = new Map<string, { resolve(result: any): void; reject(error: Error): void }>();
  /** The hand-offs that exchange messages while they run, by element. */
  private readonly talks = new Map<string, Talk>();
  private prompting: Promise<unknown> = Promise.resolve();

  constructor(name: string, { command, cwd }: RunnerCommand, repo: string, log: RunLog, options: { timeout?: number; local?: string }) {
    this.name = name;
    this.argv = shellWords(command);
    this.cwd = cwd;
    this.dir = repo;
    this.log = log;
    this.timeout = options.timeout;
    this.local = options.local;
  }

  /** Starts it, and asks which elements it will run; undefined when its command is not on this machine, so it
   * claims none. */
  async claims(): Promise<Claims | undefined> {
    let answer: Record<string, any>;
    try {
      answer = await this.open();
    } catch (error) {
      if ((error as { code?: unknown }).code === 'ENOENT') return undefined;
      void this.shutdown();
      // What it lacks to run this study, in its own words; else it never spoke.
      if (error instanceof Refused) throw new Error(`the ${this.name} runner cannot run this study: ${error.message}`);
      throw new Error(`the ${this.name} runner did not answer initialize (${(error as Error).message}): this walk speaks hand-off protocol ${PROTOCOL}`);
    }
    if (answer?.protocol !== PROTOCOL) {
      void this.shutdown();
      throw new Error(`${this.name} speaks hand-off protocol ${answer?.protocol}; this walk speaks ${PROTOCOL}`);
    }
    return { elements: answer.elements ?? [], live: answer.live ?? true };
  }

  /** The process, started and told the plan and the run. */
  private open(): Promise<Record<string, any>> {
    const cache = path.join(this.dir, '.cache');
    // The walk's own pid, so whatever a runner leaves running for the study can follow the walk; unbuffered, so a
    // Python runner's lines come as it writes them.
    const child = this.child = spawn(this.argv[0], this.argv.slice(1), {
      cwd: this.cwd,
      env: { ...process.env, STUDYFLOW_RUN_PID: String(process.pid), PYTHONUNBUFFERED: '1', ...(this.local ? { STUDYFLOW_LOCAL: this.local } : {}) },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const ended = (error: Error): void => {
      if (this.child === child) this.child = undefined;
      for (const [id, asked] of [...this.waiting]) {
        this.waiting.delete(id);
        asked.reject(error);
      }
    };
    child.on('error', ended);
    child.on('close', (code) => ended(new Error(`its process ended${code ? ` with code ${code}` : ''}`)));
    child.stdin.on('error', () => undefined); // a runner that is gone: its `close` says so
    createInterface({ input: child.stdout }).on('line', (line) => this.heard(line));
    return this.request('initialize', { protocol: PROTOCOL, plan: path.join(cache, 'plan.json'), run: { dir: this.dir, cache } });
  }

  private write(message: Rpc): void {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  private request(method: string, params: Record<string, unknown>): Promise<any> {
    const id = `w${this.asked += 1}`;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  /** One line from the runner: an answer, a message along a flow, a line for the log, a question for the person. */
  private heard(line: string): void {
    let message: Rpc | undefined;
    try {
      message = JSON.parse(line);
    } catch { /* not the protocol: a line something under the runner printed */ }
    if (!message || typeof message !== 'object' || (message.method === undefined && message.id === undefined)) {
      if (line.trim()) this.log.event('runner.stdout', `    ${line.trimEnd()}`);
      return;
    }
    const { id, method, params = {} } = message;
    if (method === undefined) {
      const asked = this.waiting.get(String(id));
      this.waiting.delete(String(id));
      if (message.error) asked?.reject(new Refused(message.error.message ?? 'it failed', message.error.data));
      else asked?.resolve(message.result);
    } else if (method === 'log') {
      this.log.event('runner.stdout', `    ${String(params.text ?? '').trimEnd()}`);
    } else if (method === 'message') {
      const talk = this.talks.get(params.element);
      if (talk) talk.send({ flow: params.flow, content: params.content, id: params.id, inReplyTo: params.inReplyTo });
      else this.log.event('message.misrouted', `    ✉ the ${this.name} runner sent a message for ${params.element}, which exchanges none now`, { level: 'warning' });
    } else if (method === 'prompt') {
      const answer = this.prompting = this.prompting.then(() => this.prompt(String(params.text ?? ''), String(params.default ?? '')));
      void answer.then((result) => this.write({ id, result }));
    } else if (id !== undefined) {
      this.write({ id, error: { code: -32601, message: `the walk has no method ${method}` } });
    }
  }

  /** A question for the person running the study, one at a time; the default when there is no terminal to ask at. */
  private async prompt(text: string, fallback: string): Promise<string> {
    if (!process.stdin.isTTY) return fallback;
    const terminal = createPrompt({ input: process.stdin, output: process.stderr });
    try {
      return (await terminal.question(`${text} `)) || fallback;
    } finally {
      terminal.close();
    }
  }

  /** One hand-off. While it runs, each message the runner sends goes along the flow it names, and each message along
   * a flow into the element is passed on as it arrives. A hand-off that is stopped (a timer at a boundary event, or
   * `--step-timeout`) is told `cancel`; a runner that does not answer in time is ended, and started again for the
   * next hand-off. */
  async element(id: string, values: Record<string, unknown>, { message, talk, signal }: { message?: Message; talk?: Talk; signal?: AbortSignal } = {}): Promise<Handback> {
    if (!this.child) await this.open();
    const child = this.child!;
    let over = false;
    let finish = (): void => undefined;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    if (talk) {
      this.talks.set(id, talk);
      void (async () => {
        while (!over) {
          for (const due of talk.take()) this.write({ method: 'message', params: { element: id, message: due } });
          await Promise.race([talk.arrived(), finished]);
        }
      })();
    }
    let stopped: string | undefined;
    let grace: NodeJS.Timeout | undefined;
    const cancel = (why: string): void => {
      if (stopped) return;
      stopped = why;
      this.write({ method: 'cancel', params: { element: id } });
      grace = setTimeout(() => end(child), GRACE_MS);
    };
    const timer = this.timeout ? setTimeout(() => cancel(`took longer than ${this.timeout}s, and was stopped`), this.timeout * 1000) : undefined;
    const aborted = (): void => cancel('was stopped');
    signal?.addEventListener('abort', aborted);
    try {
      return await this.request('execute', { element: id, values, ...(message ? { message } : {}) });
    } catch (error) {
      // What it had bound before it failed comes back with the failure.
      const partial = error instanceof Refused && error.data && typeof error.data === 'object' ? error.data as Handback : undefined;
      throw new HandoffError(`${this.name}: ${stopped ? `${id} ${stopped}` : (error as Error).message}`, partial);
    } finally {
      clearTimeout(timer);
      clearTimeout(grace);
      signal?.removeEventListener('abort', aborted);
      over = true;
      finish();
      this.talks.delete(id);
    }
  }

  /** The run is over: the runner is told, and ended if it stays. */
  async shutdown(): Promise<void> {
    const { child } = this;
    if (!child) return;
    const closed = new Promise<void>((resolve) => { child.once('close', () => resolve()); });
    this.request('shutdown', {}).catch(() => undefined);
    const grace = setTimeout(() => end(child), GRACE_MS);
    await closed;
    clearTimeout(grace);
  }
}

/** Ends a runner's process: asked first, so a command that wraps it (`uv run`) passes the signal on. */
function end(child: Process): void {
  child.kill('SIGTERM');
  const last = setTimeout(() => child.kill('SIGKILL'), GRACE_MS);
  child.once('close', () => clearTimeout(last));
}
