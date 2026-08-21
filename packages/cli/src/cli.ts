import { Command } from 'commander';

import { convert } from '@cli/convert';
import { validate } from '@cli/validate';
import { info } from '@cli/info';
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
  .description('Convert between .studyflow YAML, BPMN XML, and .studyflow.png (extract, re-embed, or render).')
  .argument('<input>', 'source file: .studyflow(.yaml), .bpmn/.xml, or .studyflow.png')
  .argument('<output>', 'target file; its extension picks the format')
  .option('--into <png>', 'for a PNG target: the image to embed into')
  .option('--modeler', 'for a PNG target: draw the image by driving the modeler (repo workspace only)')
  .option('--origin <origin>', 'modeler dev server for --modeler (started if not up)', 'http://127.0.0.1:4175')
  .action(async (input: string, output: string, options: { into?: string; modeler?: boolean; origin?: string }) => {
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
  .description('Execute a studyflow in the runtime it declares (or --runtime). `local` dispatches to studyflow-run.')
  .passThroughOptions()
  .argument('<input>', 'studyflow file: .studyflow(.yaml), .bpmn/.xml, or .studyflow.png')
  .argument('[runnerArgs...]', 'forwarded to studyflow-run (e.g. --repo, --fresh, --sim, --auto)')
  .option('--runtime <runtime>', 'override the document: browser | cloud | local | hpc')
  .action(async (input: string, runnerArgs: string[], options: { runtime?: string }) => {
    const { run } = await import('@cli/run');
    await run(input, runnerArgs, options);
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
