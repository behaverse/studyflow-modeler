import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { primaryRoots } from '@core/document';
import { asXml, parseSource, readSource } from '@cli/studyfile';

/**
 * `studyflow run` — executes a studyflow in the runtime the document declares
 * (`studyflow:Study`'s `runtime` attribute, a `RuntimeEnum`) or the one given
 * with `--runtime`. `local` delegates to the Python runner
 * (`packages/runner-py`); `browser` studies need the web runner.
 */

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

/** Run-directory names the document's provenance records (`prov:Activity#run` on `executed` entries). */
function recordedRunIds(definitions: any): string[] {
  const ids = new Set<string>();
  const seen = new Set<object>();
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node.$type === 'prov:Activity' && typeof node.run === 'string' && node.run) ids.add(node.run);
    for (const key of ['rootElements', 'flowElements', 'extensionElements', 'values']) visit(node[key]);
  };
  visit(definitions);
  return [...ids];
}

/** The value a flag carries in the pass-through args (`--flag value` or `--flag=value`). */
function passthroughValue(passthrough: string[], flag: string): string | undefined {
  const index = passthrough.indexOf(flag);
  if (index >= 0) return passthrough[index + 1];
  return passthrough.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
}

/**
 * Where the runs the provenance mentions actually live. The recorded `run` ids
 * are directory names under `<workdir>/<runs-dir>/`; when the caller gave no
 * `--workdir`, look for them from the likely roots — the cwd (the runner's own
 * default), the workdir an archived copy sits inside (`<W>/<runs-dir>/<id>/file`),
 * and the input file's directory — so partial re-runs find their artifacts.
 */
function inferredWorkdir(input: string, passthrough: string[], definitions: any): string | undefined {
  if (passthroughValue(passthrough, '--workdir') !== undefined) return undefined;
  const runIds = recordedRunIds(definitions);
  if (runIds.length === 0) return undefined;

  const runsDir = passthroughValue(passthrough, '--runs-dir') ?? 'runs';
  const hasRecordedRun = (dir: string): boolean =>
    runIds.some((id) => existsSync(path.join(dir, runsDir, id)));

  const inputDir = path.dirname(path.resolve(input));
  const candidates = [process.cwd()];
  // An archived copy lives at <W>/<runs-dir>/<id>/<file>; its workdir is <W>.
  if (path.basename(path.dirname(inputDir)) === runsDir) candidates.push(path.dirname(path.dirname(inputDir)));
  candidates.push(inputDir);

  const found = candidates.find(hasRecordedRun);
  return found && found !== process.cwd() ? found : undefined;
}

function which(binary: string): boolean {
  return spawnSync('which', [binary], { stdio: 'ignore' }).status === 0;
}

/** The Python runner: env override, then the repo checkout next to this CLI, then PATH. */
function pythonRunnerCommand(): { command: string; args: string[] } {
  const override = process.env.STUDYFLOW_RUN_PY;
  if (override) return { command: 'uv', args: ['run', '--script', override] };

  const repoScript = fileURLToPath(new URL('../../runner-py/studyflow_run.py', import.meta.url));
  if (existsSync(repoScript) && which('uv')) return { command: 'uv', args: ['run', '--script', repoScript] };

  if (which('studyflow-run')) return { command: 'studyflow-run', args: [] };

  throw new Error(
    'No Python runner found. Install uv and run from the repo workspace, '
    + 'install the studyflow-runner package (`studyflow-run` on PATH), '
    + 'or point STUDYFLOW_RUN_PY at studyflow_run.py.',
  );
}

async function runLocal(
  input: string,
  source: Awaited<ReturnType<typeof readSource>>,
  passthrough: string[],
): Promise<number> {
  // The Python runner reads XML (bare, or embedded in a PNG) but not the YAML
  // spelling — hand YAML over as a temporary .bpmn. Inputs stay resolved
  // against the caller's cwd either way (the runner's --workdir default).
  let target = input;
  if (source.container === 'text' && source.kind === 'yaml') {
    const dir = await mkdtemp(path.join(tmpdir(), 'studyflow-run-'));
    target = path.join(dir, `${path.basename(input).replace(/\.[^.]*$/, '')}.bpmn`);
    await writeFile(target, await asXml(source), 'utf8');
  }

  const { command, args } = pythonRunnerCommand();
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
    const workdir = inferredWorkdir(input, passthrough, definitions);
    if (workdir) {
      console.error(`Reusing workdir ${workdir} — the runs recorded in the document's provenance live there.`);
      passthrough = ['--workdir', workdir, ...passthrough];
    }
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
