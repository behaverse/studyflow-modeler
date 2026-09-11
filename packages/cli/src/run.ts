import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, realpathSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { declaredRuntime } from '@core/document';
import { asXml, parseSource, readSource } from '@cli/studyfile';

/* `studyflow run`: hand the study to the runtime it declares; this CLI runs `local` itself (skills/local/run.py). */

export type RunOptions = {
  runtime?: string;
};

/** Where the local runtime, `skills/local/run.py` (which finds the other skills beside it), can be, best first:
 * the repo's `skills/` when this is the bundle in a checkout, Homebrew's `libexec/` next to `bin/studyflow`,
 * then beside the binary (the release tarball as unpacked). */
function runnerScriptCandidates(): string[] {
  const candidates: string[] = [];

  if (import.meta.url.startsWith('file:')) {
    candidates.push(fileURLToPath(new URL('../../../skills/local/run.py', import.meta.url)));
  }

  try {
    const binDir = path.dirname(realpathSync(process.execPath));
    candidates.push(path.join(binDir, '..', 'libexec', 'skills', 'local', 'run.py'), path.join(binDir, 'skills', 'local', 'run.py'));
  } catch { /* execPath is unreadable on some sandboxes; the other candidates still stand */ }

  return candidates;
}

/** Where `binary` sits on PATH, if it is there and executable. */
function onPath(binary: string): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, binary);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* not here; keep looking */ }
  }
  return undefined;
}

/** The local runtime: `STUDYFLOW_RUN_PY` when set, else the one shipped with this CLI; both need `uv`. */
function runnerCommand(): { command: string; args: string[] } {
  const override = process.env.STUDYFLOW_RUN_PY;
  if (override) return { command: 'uv', args: ['run', '--script', override] };

  if (onPath('uv')) {
    for (const script of runnerScriptCandidates()) {
      if (existsSync(script)) return { command: 'uv', args: ['run', '--script', path.normalize(script)] };
    }
  }

  throw new Error(
    'No runner found. Install uv (`brew install uv`, or https://docs.astral.sh/uv/) so the local runtime shipped with this CLI (skills/local/run.py) can run, '
    + 'or point STUDYFLOW_RUN_PY at one.',
  );
}

async function runLocal(
  input: string,
  source: Awaited<ReturnType<typeof readSource>>,
  passthrough: string[],
): Promise<number> {
  // The runners read XML but not YAML; a temporary `.bpmn` is safe because nothing sits beside it to resolve inputs against.
  let target = input;
  if (source.container === 'text' && source.kind === 'yaml') {
    const dir = await mkdtemp(path.join(tmpdir(), 'studyflow-run-'));
    target = path.join(dir, `${path.basename(input).replace(/\.[^.]*$/, '')}.bpmn`);
    await writeFile(target, await asXml(source), 'utf8');
  }

  const { command, args } = runnerCommand();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args, target, ...passthrough], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolvePromise(code ?? 1));
  });
}

export async function run(input: string, passthrough: string[], options: RunOptions): Promise<void> {
  const source = await readSource(input);
  const { definitions } = await parseSource(source);

  // No list of runtimes here: a skill may add one to `RuntimeEnum`, and one this CLI cannot run is refused below.
  const runtime = options.runtime ?? declaredRuntime(definitions);

  if (runtime === 'local') {
    process.exitCode = await runLocal(input, source, passthrough);
    return;
  }

  if (runtime === 'browser') {
    throw new Error(
      'This study declares the browser runtime (participant-facing). Run it in the web runner: '
      + 'upload the file at <site>/run/, or in a repo checkout `npm run dev` and open http://localhost:5173/run/. '
      + 'To force the analysis half locally instead: `studyflow run --runtime local <file>`.',
    );
  }

  throw new Error(
    `The ${runtime} runtime is not wired up in this CLI yet — `
    + 'run it with `--runtime local` to execute on this machine instead.',
  );
}
