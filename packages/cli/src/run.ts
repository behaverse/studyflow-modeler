import { existsSync, realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { embedStudyflowIntoPng, protocolDigest, replaceStudyflowInSvg } from '@core/document';
import { planChecks } from '@core/checks';
import type { StudyModel } from '@core/model/index';
import { parseSource, readSource, sourceOf, studySource } from '@cli/studyfile';
import { runLocal, type LocalRun } from '@skills/local/src/run';

/* `studyflow run`: hand the study to the runtime it declares; this CLI hosts `local` itself (skills/local). */

/** What the run record names as the tool that ran it (`with`). */
const TOOL = `studyflow-cli/${import.meta.env?.APP_VERSION ?? 'dev'}`;

export type RunOptions = Pick<LocalRun, 'repo' | 'inputs' | 'from' | 'fresh' | 'quiet' | 'debug' | 'stepTimeout'> & {
  runtime?: string;
  runner?: string[];
  option?: string[];
};

/** Where the shipped skills, whose runners the local runtime hands elements to, can be: the repo's `skills/` when
 * this is the bundle in a checkout, Homebrew's `libexec/` next to `bin/studyflow`, then beside the binary (the
 * release tarball as unpacked). */
function skillRoots(): string[] {
  const candidates: string[] = [];
  if (import.meta.url.startsWith('file:')) candidates.push(fileURLToPath(new URL('../../../skills', import.meta.url)));
  try {
    const binDir = path.dirname(realpathSync(process.execPath));
    candidates.push(path.join(binDir, '..', 'libexec', 'skills'), path.join(binDir, 'skills'));
  } catch { /* execPath is unreadable on some sandboxes; the other candidates still stand */ }
  return candidates.filter((candidate) => existsSync(path.join(candidate, 'local', 'SKILL.md'))).slice(0, 1);
}

async function runLocally(input: string, source: Awaited<ReturnType<typeof readSource>>, model: StudyModel, digest: string, options: RunOptions): Promise<number> {
  // The run repository keeps the study as the original is named and spelled: YAML as YAML, XML as XML, an image with
  // the study inside.
  const write = async (study: StudyModel, target: string): Promise<void> => {
    if (source.container === 'text') return writeFile(target, await studySource(study, source.kind), 'utf8');
    const base = existsSync(target) ? target : input;
    await writeFile(target, source.container === 'png'
      ? embedStudyflowIntoPng(new Uint8Array(await readFile(base)), await studySource(study, 'yaml'))
      : replaceStudyflowInSvg(await readFile(base, 'utf8'), await studySource(study, 'xml')));
  };
  return runLocal({
    input,
    model,
    write,
    read: async (bytes) => (await parseSource(sourceOf(bytes, source.container), { asWritten: true })).model,
    skillRoots: skillRoots(),
    digest,
    tool: TOOL,
    repo: options.repo,
    inputs: options.inputs,
    from: options.from,
    fresh: options.fresh,
    quiet: options.quiet,
    debug: options.debug,
    stepTimeout: options.stepTimeout,
    runners: options.runner,
    options: options.option,
  });
}

export async function run(input: string, options: RunOptions): Promise<void> {
  const source = await readSource(input);
  const { model } = await parseSource(source);

  // No list of runtimes here: a skill may add one to `RuntimeEnum`, and one this CLI cannot run is refused below.
  const runtime = options.runtime ?? model.runtime();

  if (runtime === 'local') {
    // The checks `studyflow validate` applies to the plan; an error among them keeps the study from starting.
    const issues = planChecks(model);
    for (const { severity, message } of issues) (severity === 'error' ? console.error : console.warn)(`${severity}: ${message}`);
    if (issues.some((issue) => issue.severity === 'error')) {
      process.exitCode = 1;
      return;
    }
    const { model: written } = await parseSource(source, { asWritten: true });
    process.exitCode = await runLocally(input, source, written, await protocolDigest(model), options);
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
