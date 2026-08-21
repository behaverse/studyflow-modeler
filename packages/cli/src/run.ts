import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { primaryRoots } from '@core/document';
import { onPath } from '@cli/plugin';
import { asXml, parseSource, readSource } from '@cli/studyfile';

/* `studyflow run`, specified in packages/cli/README.md. */

export type RunOptions = {
  runtime?: string;
};

const RUNTIMES = ['browser', 'cloud', 'local', 'hpc'];

/** The study's declared runtime; the schema's default is `cloud`. */
function declaredRuntime(definitions: any): string {
  const root = primaryRoots(definitions)[0];
  const value = root?.runtime ?? root?.$attrs?.runtime ?? root?.$attrs?.['studyflow:runtime'];
  return typeof value === 'string' && value ? value : 'cloud';
}

/** Every `studyflow-run.py` this build could be sitting next to, best first. */
function runnerScriptCandidates(): string[] {
  const candidates: string[] = [];

  // The repo checkout, when this is the bundle rather than a compiled binary.
  if (import.meta.url.startsWith('file:')) {
    candidates.push(fileURLToPath(new URL('../src/studyflow-run.py', import.meta.url)));
  }

  // The copy an installer put beside the binary (Homebrew: `bin/studyflow`, scripts in `libexec/`).
  try {
    const binDir = path.dirname(realpathSync(process.execPath));
    candidates.push(path.join(binDir, '..', 'libexec', 'studyflow-run.py'), path.join(binDir, 'studyflow-run.py'));
  } catch { /* execPath is unreadable on some sandboxes; the other candidates still stand */ }

  return candidates;
}

/**
 * The runner, in the order documented in the CLI README: an explicit
 * `STUDYFLOW_RUN_PY`, then an installed `studyflow-run` companion, then the
 * script shipped beside this CLI (which needs `uv` to pull its dependencies).
 * The runner discovers studyflow-prov and the schema runners itself.
 */
function runnerCommand(): { command: string; args: string[] } {
  const override = process.env.STUDYFLOW_RUN_PY;
  if (override) return { command: 'uv', args: ['run', '--script', override] };

  const companion = onPath('studyflow-run');
  if (companion) return { command: companion, args: [] };

  if (onPath('uv')) {
    for (const script of runnerScriptCandidates()) {
      if (existsSync(script)) return { command: 'uv', args: ['run', '--script', path.normalize(script)] };
    }
  }

  throw new Error(
    'No runner found. Install uv so the studyflow-run.py shipped with this CLI can run, '
    + 'or point STUDYFLOW_RUN_PY at a studyflow-run.py.',
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

  const runtime = options.runtime ?? declaredRuntime(definitions);
  if (!RUNTIMES.includes(runtime)) {
    throw new Error(`Unknown runtime "${runtime}" — the studyflow schema knows: ${RUNTIMES.join(', ')}.`);
  }

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
