import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { declaredRuntime } from '@core/document';
import { onPath } from '@cli/plugin';
import { asXml, parseSource, readSource } from '@cli/studyfile';

/* `studyflow run`, specified in packages/cli/README.md. */

export type RunOptions = {
  runtime?: string;
};

const RUNTIMES = ['browser', 'cloud', 'local', 'hpc'];

/** Every `studyflow-run-local.py` this build could be sitting next to, best first. */
function runnerScriptCandidates(): string[] {
  const candidates: string[] = [];

  // The repo checkout, when this is the bundle rather than a compiled binary.
  if (import.meta.url.startsWith('file:')) {
    candidates.push(fileURLToPath(new URL('../src/studyflow-run-local.py', import.meta.url)));
  }

  // The copy an installer put beside the binary (Homebrew: `bin/studyflow`, scripts in `libexec/`).
  try {
    const binDir = path.dirname(realpathSync(process.execPath));
    candidates.push(path.join(binDir, '..', 'libexec', 'studyflow-run-local.py'), path.join(binDir, 'studyflow-run-local.py'));
  } catch { /* execPath is unreadable on some sandboxes; the other candidates still stand */ }

  return candidates;
}

/** The repo's partial runners (`runners/studyflow-*.py`), when this is the bundle in a checkout rather than an installed binary. */
function repoRunnersDir(): string | undefined {
  if (!import.meta.url.startsWith('file:')) return undefined;
  const dir = fileURLToPath(new URL('../../../runners', import.meta.url));
  return existsSync(dir) ? dir : undefined;
}

/** The runner, in the CLI README's order: `STUDYFLOW_RUN_PY`, an installed `studyflow-run-local`
 * companion, then the script beside this CLI (needs `uv`). It finds studyflow-prov and the schema runners itself. */
function runnerCommand(): { command: string; args: string[] } {
  const override = process.env.STUDYFLOW_RUN_PY;
  if (override) return { command: 'uv', args: ['run', '--script', override] };

  const companion = onPath('studyflow-run-local');
  if (companion) return { command: companion, args: [] };

  if (onPath('uv')) {
    for (const script of runnerScriptCandidates()) {
      if (existsSync(script)) return { command: 'uv', args: ['run', '--script', path.normalize(script)] };
    }
  }

  throw new Error(
    'No runner found. Install uv so the studyflow-run-local.py shipped with this CLI can run, '
    + 'or point STUDYFLOW_RUN_PY at a studyflow-run-local.py.',
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
    const runnersDir = repoRunnersDir();
    const env = runnersDir ? { ...process.env, STUDYFLOW_RUNNERS: runnersDir } : process.env;
    const child = spawn(command, [...args, target, ...passthrough], { stdio: 'inherit', env });
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
