import { Command } from 'commander';

import { convert } from '@cli/convert';
import { validate } from '@cli/validate';
import { info } from '@cli/info';
import { mcp } from '@cli/mcp';
import { prov } from '@cli/prov';
import { addSkill, installedSchemas, installedSkills, removeSkill, skillsHome } from '@cli/skills';
import { edit } from '@desktop/edit';
import type { RunOptions } from '@cli/run';

const program = new Command();

program
  .name('studyflow')
  .description('Work with studyflow files: convert between formats, validate, inspect.')
  .version(import.meta.env?.APP_VERSION ?? 'dev');

program
  .command('convert')
  .description('Convert between .studyflow YAML, BPMN XML, .studyflow.png and .studyflow.svg (extract, re-embed, or render).')
  .argument('<input>', 'source file: .studyflow(.yaml), .bpmn/.xml, .studyflow.png or .studyflow.svg')
  .argument('<output>', 'target file; its extension picks the format')
  .option('--into <image>', 'for a PNG or SVG target: the image to embed into')
  .option('--modeler', 'for a PNG or SVG target: draw the image by driving the modeler (repo workspace only)')
  .option('--origin <origin>', 'modeler dev server for --modeler (started if not up)', 'http://127.0.0.1:4175')
  .option('--strict', 'write nothing and exit non-zero on reader warnings')
  .action(async (input: string, output: string, options: { into?: string; modeler?: boolean; origin?: string; strict?: boolean }) => {
    console.log(await convert(input, output, options));
  });

const skill = program
  .command('skill')
  .description(`Skills installed beside the CLI, in ${'$'}STUDYFLOW_HOME/skills (~/.studyflow/skills): a vocabulary and runners a domain brings, found by validate, convert, mcp, run and the desktop app (edit, ui).`);
skill
  .command('add')
  .argument('<source>', 'a git URL or a folder holding the skill\'s SKILL.md')
  .description('Install a skill (a skill of the same name is replaced).')
  .action((source: string) => {
    const added = addSkill(source);
    console.log(`Installed ${added.manifest.name} in ${added.folder}${added.schemas.length > 0 ? ` (schema ${added.schemas.map((schema) => `${schema.prefix}:`).join(', ')})` : ''}`);
  });
skill
  .command('list')
  .description('The installed skills.')
  .action(() => {
    const skills = installedSkills();
    if (skills.length === 0) console.log(`No skill installed in ${skillsHome()}.`);
    for (const { manifest, schemas } of skills) {
      const runs = Object.keys(manifest.runtimes ?? {}).join(', ');
      const prefixes = schemas.map((schema) => `  ${schema.prefix}:`).join('');
      console.log(`${manifest.name}${prefixes}${runs ? `  runs in ${runs}` : ''}  ${manifest.description.split('. ')[0]}`);
    }
  });
skill
  .command('remove')
  .argument('<name>', 'the installed skill\'s name')
  .description('Uninstall a skill.')
  .action((name: string) => {
    if (!removeSkill(name)) {
      console.error(`No skill ${name} in ${skillsHome()}.`);
      process.exitCode = 1;
    }
  });

program
  .command('mcp')
  .description('Serve a studyflow to an AI assistant as a Model Context Protocol server on stdio: the canvas\'s study tools, `check`, and `save` back to the file.')
  .argument('<file>', 'the .studyflow.yaml or BPMN XML file to edit')
  .action(async (file: string) => {
    await mcp(file);
  });

program
  .command('validate')
  .description('Check a studyflow: that it reads, its edges join what they may, it is sound, takes only paths the runners walk, reads only columns its schemas define, holds the content it registers by digest (a trial list, a consent form), and is valid BPMN 2.0 XML (against the OMG schema, with xmllint); once run, that its counts balance and its protocol is the one the run recorded.')
  .argument('<input>', 'file to check')
  .option('--strict', 'exit non-zero on warnings, not just errors')
  .action(async (input: string, options: { strict?: boolean }) => {
    const report = await validate(input);
    for (const warning of report.warnings) console.warn(`warning: ${warning}`);
    for (const error of report.errors) console.error(`error: ${error}`);
    if (!report.ok || (options.strict && report.warnings.length > 0)) process.exitCode = 1;
    else console.log(`${input}: OK${report.warnings.length ? ` (${report.warnings.length} warning${report.warnings.length === 1 ? '' : 's'})` : ''}${report.note ? `, ${report.note}` : ''}`);
  });

program
  .command('prov')
  .description('Write a run\'s record as W3C PROV-O (Turtle): the run and each step as a prov:Activity under the study as its prov:Plan, and what they wrote, sent and made as prov:Entity. The `prov:` records in a study are Studyflow\'s own; this is their W3C form.')
  .argument('<record>', 'the run\'s events.jsonl, or the run repository holding it')
  .argument('[output]', 'the Turtle file to write (default: standard output)')
  .action((record: string, output?: string) => {
    console.log(prov(record, output));
  });

const collect = (value: string, all: string[] = []): string[] => [...all, value];

program
  .command('run')
  .description('Execute a studyflow in the runtime it declares (or --runtime). `local` walks it on this machine (packages/runtime-local), once the plan passes the checks `validate` applies to it, and hands each element to the skill that claims it.')
  .argument('<input>', 'studyflow file: .studyflow(.yaml), .bpmn/.xml, .studyflow.png or .studyflow.svg')
  .option('--runtime <runtime>', 'override the document: local | browser')
  .option('--author <name>', 'who runs the study, as git writes an author (\'Name <email>\', the email optional): the run\'s commits and its record name them. Without it they name no one (studyflow-runner), never this machine\'s user')
  .option('--repo <dir>', 'the run repository to write into, its name being the run id (default: the study\'s own directory when it already lives in one, else a fresh ~/.studyflow/runs/<YYMMDD+codename>)')
  .option('--data-outside-history', 'keep the run\'s data out of the run repository\'s history: its commits hold the study and data.sha256, the SHA-256 of every other file in the run directory (the record, the log, each file a step wrote), which stay in the directory alone. Asked at a repository\'s first commit, every later run in it keeps it')
  .option('--inputs <dir>', 'also stage boundary inputs from this directory, after the study\'s own and before the working directory; repeatable', collect)
  .option('--from <ref>', 're-run from this point in the repository\'s history (a commit-ish), branching there')
  .option('--fresh', 'ignore the study\'s per-element run records and re-run every step')
  .option('--quiet', 'no console output; the log file is written either way')
  .option('--runner <name=command>', 'override a discovered partial runner, or add one: COMMAND is started once, and speaks the hand-off protocol on its stdin and stdout; repeatable', collect)
  .option('--debug', 'keep the .cache folder, with the values after each element, and write the debug lines to studyflow.log')
  .option('--option <name[=value]>', 'an option for the runners, in plan.json `options` (`--option sim` drives a simulated robot, `--option auto` answers prompts with canned values); repeatable', collect)
  .option('--step-timeout <seconds>', 'stop a hand-off that takes longer, and fail its step', Number)
  .option('--start-timeout <seconds>', 'stop the run when a runner takes longer to answer initialize (default: 600, as a first `uv run` installs its packages)', Number)
  .option('--allocation-seed <gateway=seed>', 'the seed of a random gateway that conceals its allocation (its seedDigest), held against that digest; `GATEWAY=@FILE` reads it from a file, out of the shell history. The executed copy reveals it; repeatable', collect)
  .action(async (input: string, options: RunOptions) => {
    const { run } = await import('@cli/run');
    await run(input, options);
  });

type ServeOptions = { port: string; host: string; open: boolean };
const serveOptions = (command: Command): Command => command
  .option('--port <port>', 'port to listen on', '4174')
  .option('--host <host>', 'address to bind', '127.0.0.1')
  .option('--no-open', 'print the URL instead of opening a window');

serveOptions(program
  .command('edit')
  .description('Open a studyflow in the desktop app: the modeler served from this machine, no network needed, in a window of its own (needs a Chromium: Chrome, Chromium, Brave or Edge; else the default browser).')
  .argument('[file]', 'studyflow to open: .studyflow(.yaml), .bpmn/.xml, .studyflow.png or .studyflow.svg'))
  .action(async (file: string | undefined, options: ServeOptions) => {
    await edit(file, { port: Number(options.port), host: options.host, open: options.open, installed: installedSchemas() });
  });

serveOptions(program
  .command('ui')
  .description('Open the desktop app on a blank canvas (`studyflow edit` without a file).'))
  .action(async (options: ServeOptions) => {
    await edit(undefined, { port: Number(options.port), host: options.host, open: options.open, installed: installedSchemas() });
  });

program
  .command('info')
  .description('Show what a studyflow file contains.')
  .argument('<input>', 'file to inspect')
  .option('--json', 'machine-readable output')
  .action(async (input: string, options: { json?: boolean }) => {
    const report = await info(input);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const { study, file, protocol, elements, warnings } = report;
    console.log(`${study.name ?? study.id ?? '(unnamed study)'}${study.version ? ` v${study.version}` : ''}`);
    if (study.id) console.log(`  id: ${study.id}`);
    console.log(`  protocol: ${protocol}`);
    if (study.documentation) console.log(`  ${study.documentation.split('\n')[0]}`);
    console.log(`  source: ${file.kind}${file.container === 'text' ? '' : ` (embedded in ${file.container.toUpperCase()})`}`);
    const total = Object.values(elements).reduce((sum, n) => sum + n, 0);
    console.log(`  elements: ${total}`);
    for (const [type, n] of Object.entries(elements).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${type}: ${n}`);
    }
    if (warnings.length) console.log(`  warnings: ${warnings.length} (run \`studyflow validate\` to see them)`);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
