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

/** Where `studyflow-run-local.py` (with studyflow-prov and the partial runners beside it) can be, best first:
 * the repo's `packages/cli/runners/` when this is the bundle in a checkout, Homebrew's `libexec/` next to
 * `bin/studyflow`, then flat beside the binary (the release tarball as unpacked). */
function runnerScriptCandidates(): string[] {
  const candidates: string[] = [];

  if (import.meta.url.startsWith('file:')) {
    candidates.push(fileURLToPath(new URL('../runners/studyflow-run-local.py', import.meta.url)));
  }

  try {
    const binDir = path.dirname(realpathSync(process.execPath));
    candidates.push(path.join(binDir, '..', 'libexec', 'studyflow-run-local.py'), path.join(binDir, 'studyflow-run-local.py'));
  } catch { /* execPath is unreadable on some sandboxes; the other candidates still stand */ }

  return candidates;
}

/** The runner, in the CLI README's order: `STUDYFLOW_RUN_PY`, an installed `studyflow-run-local`
 * companion, then the script shipped with this CLI (needs `uv`). It finds studyflow-prov and the partial runners beside itself. */
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
    'No runner found. Install uv (`brew install uv`, or https://docs.astral.sh/uv/) so the studyflow-run-local.py shipped with this CLI can run, '
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
