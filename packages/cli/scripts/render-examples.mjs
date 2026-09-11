/**
 * `npm run examples:render [-- <name>...] [--origin <url>]`: redraw the shipped example PNGs from their own embedded
 * studyflow, by the modeler (repo workspace only). Names pick examples (`kitchensink`); `--origin` uses a modeler
 * already running there instead of starting one per example.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repoDir = resolve(import.meta.dirname, '../../..');
const sh = (command, args) => execFileSync(command, args, { cwd: repoDir, stdio: 'inherit' });

const args = process.argv.slice(2);
const originAt = args.indexOf('--origin');
const origin = originAt >= 0 ? ['--origin', args[originAt + 1]] : [];
const names = args.filter((arg, i) => !arg.startsWith('--') && (originAt < 0 || i !== originAt + 1));

sh('npm', ['run', 'build', '-w', '@behaverse/studyflow-cli']);
const examples = readdirSync(resolve(repoDir, 'skills'), { recursive: true }).map(String)
  .filter((file) => /^[^/]+\/examples\/[^/]+\.studyflow\.png$/.test(file))
  .filter((file) => names.length === 0 || names.some((name) => file.endsWith(`/${name}.studyflow.png`)))
  .sort();
for (const example of examples) {
  const png = `skills/${example}`;
  sh('node', ['packages/cli/dist/studyflow.mjs', 'convert', '--modeler', ...origin, png, png]);
}
