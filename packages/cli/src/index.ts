import { Command } from 'commander';

import { convert } from '@cli/commands/convert';
import { validate } from '@cli/commands/validate';
import { info } from '@cli/commands/info';
import { companionNames, findCompanion, runCompanion } from '@cli/plugin';

const program = new Command();

// Lets `run` forward everything after the input file to the underlying runner.
program.enablePositionalOptions();

program
  .name('studyflow')
  .description('Work with studyflow files: convert between formats, validate, inspect.')
  .version(import.meta.env?.APP_VERSION ?? 'dev');

program
  .command('convert')
  .description('Convert between .studyflow YAML, BPMN XML, and .studyflow.png (extract or re-embed).')
  .argument('<input>', 'source file: .studyflow(.yaml), .bpmn/.xml, or .studyflow.png')
  .argument('<output>', 'target file; its extension picks the format')
  .option('--into <png>', 'for a PNG target: the image to embed into')
  .action(async (input: string, output: string, options: { into?: string }) => {
    console.log(await convert(input, output, options));
  });

program
  .command('validate')
  .description('Parse a studyflow and report reader warnings and errors.')
  .argument('<input>', 'file to check')
  .option('--strict', 'exit non-zero on warnings, not just errors')
  .action(async (input: string, options: { strict?: boolean }) => {
    const report = await validate(input);
    for (const warning of report.warnings) console.warn(`warning: ${warning}`);
    for (const error of report.errors) console.error(`error: ${error}`);
    if (!report.ok || (options.strict && report.warnings.length > 0)) process.exitCode = 1;
    else console.log(`${input}: OK${report.warnings.length ? ` (${report.warnings.length} warning${report.warnings.length === 1 ? '' : 's'})` : ''}`);
  });

program
  .command('run')
  .description('Execute a studyflow in the runtime it declares (or --runtime). `local` uses the Python runner.')
  .passThroughOptions()
  .argument('<input>', 'studyflow file: .studyflow(.yaml), .bpmn/.xml, or .studyflow.png')
  .argument('[runnerArgs...]', 'forwarded to the runner (e.g. --fresh, --repo)')
  .option('--runtime <runtime>', 'override the document: browser | cloud | local | hpc')
  .action(async (input: string, runnerArgs: string[], options: { runtime?: string }) => {
    const { run } = await import('@cli/commands/run');
    await run(input, runnerArgs, options);
  });

program
  .command('render')
  .description('Re-render example .studyflow.png images by driving the modeler (repo workspace only).')
  .argument('[names...]', 'example stems to re-render; default: all')
  .option('--dir <dir>', 'examples directory', 'assets/examples')
  .option('--origin <origin>', 'modeler dev server (started if not up)', 'http://127.0.0.1:4175')
  .action(async (names: string[], options: { dir: string; origin: string }) => {
    const { render } = await import('@cli/commands/render');
    await render(names, options);
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
    const { study, file, elements, warnings } = report;
    console.log(`${study.name ?? study.id ?? '(unnamed study)'}${study.version ? ` v${study.version}` : ''}`);
    if (study.id) console.log(`  id: ${study.id}`);
    if (study.documentation) console.log(`  ${study.documentation.split('\n')[0]}`);
    console.log(`  source: ${file.kind}${file.container === 'png' ? ' (embedded in PNG)' : ''}`);
    const total = Object.values(elements).reduce((sum, n) => sum + n, 0);
    console.log(`  elements: ${total}`);
    for (const [type, n] of Object.entries(elements).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${type}: ${n}`);
    }
    if (warnings.length) console.log(`  warnings: ${warnings.length} (run \`studyflow validate\` to see them)`);
  });

const builtIns = new Set(['help', ...program.commands.flatMap((command) => [command.name(), ...command.aliases()])]);

program.addHelpText('after', () => {
  const installed = companionNames().filter((name) => !builtIns.has(name));
  return installed.length
    ? `\nCompanions on PATH (\`studyflow <name>\` runs \`studyflow-<name>\`):\n  ${installed.join(', ')}\n`
    : '';
});

/** An unknown subcommand goes to its companion before commander calls it a mistake. */
async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2);
  if (subcommand && !subcommand.startsWith('-') && !builtIns.has(subcommand)) {
    const companion = findCompanion(subcommand);
    if (companion) {
      process.exitCode = await runCompanion(companion, rest);
      return;
    }
  }
  await program.parseAsync();
}

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
