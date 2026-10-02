import { existsSync, realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { embedStudyflowIntoPng, protocolDigest, replaceStudyflowInSvg } from '@core/document';
import { planChecks } from '@core/checks';
import { checkMaterials } from '@core/checks/materials';
import type { StudyModel } from '@core/model/index';
import { materialReader } from '@cli/materials';
import { parseSource, readSource, sourceOf, studySource } from '@cli/studyfile';
import { runLocal, type LocalRun } from '@runtime-local/run';

/* `studyflow run`: hand the study to the runtime it declares; this CLI hosts `local` itself (packages/runtime-local). */

/** What the run record names as the tool that ran it (`with`). */
const TOOL = `studyflow-cli/${import.meta.env?.APP_VERSION ?? 'dev'}`;

export type RunOptions = Pick<LocalRun, 'author' | 'repo' | 'dataOutsideHistory' | 'inputs' | 'from' | 'fresh' | 'quiet' | 'debug' | 'stepTimeout' | 'startTimeout'> & {
  runtime?: string;
  runner?: string[];
  option?: string[];
  allocationSeed?: string[];
};

/** Where a folder this CLI ships can be: in the checkout (`checkout`, from the repo's root) when this is the bundle in
 * one, Homebrew's `libexec/<installed>` next to `bin/studyflow`, then beside the binary (the release tarball as
 * unpacked). The first that holds `marker`. */
function shipped(checkout: string, installed: string, marker: string): string | undefined {
  const candidates: string[] = [];
  if (import.meta.url.startsWith('file:')) candidates.push(fileURLToPath(new URL(`../../../${checkout}`, import.meta.url)));
  try {
    const binDir = path.dirname(realpathSync(process.execPath));
    candidates.push(path.join(binDir, '..', 'libexec', installed), path.join(binDir, installed));
  } catch { /* execPath is unreadable on some sandboxes; the other candidates still stand */ }
  return candidates.find((candidate) => existsSync(path.join(candidate, marker)));
}

/** The shipped skills, whose runners the local runtime hands elements to. */
function skillRoots(): string[] {
  const found = shipped('skills', 'skills', path.join('studyflow', 'SKILL.md'));
  return found ? [found] : [];
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
    sdk: shipped('packages/runtime-local/python', 'sdk', 'runner.py'),
    digest,
    tool: TOOL,
    author: options.author,
    repo: options.repo,
    dataOutsideHistory: options.dataOutsideHistory,
    inputs: options.inputs,
    from: options.from,
    fresh: options.fresh,
    quiet: options.quiet,
    debug: options.debug,
    stepTimeout: options.stepTimeout,
    startTimeout: options.startTimeout,
    runners: options.runner,
    options: options.option,
    allocationSeeds: options.allocationSeed,
  });
}

export async function run(input: string, options: RunOptions): Promise<void> {
  const source = await readSource(input);
  const { model } = await parseSource(source);

  // No list of runtimes here: a skill may add one to `RuntimeEnum`, and one this CLI cannot run is refused below.
  const runtime = options.runtime ?? model.runtime();

  if (runtime === 'local') {
    // The checks `studyflow validate` applies to the plan, and the content of what it registers (a trial list that
    // changed); an error among them keeps the study from starting.
    const issues = [...planChecks(model), ...(await checkMaterials(model, materialReader(input))).issues];
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
