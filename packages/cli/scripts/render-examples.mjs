/** `npm run examples:render`: redraw every shipped example PNG from its own embedded studyflow, by the modeler (repo workspace only). */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repoDir = resolve(import.meta.dirname, '../../..');
const sh = (command, args) => execFileSync(command, args, { cwd: repoDir, stdio: 'inherit' });

sh('npm', ['run', 'build', '-w', '@behaverse/studyflow-cli']);
const examples = readdirSync(resolve(repoDir, 'skills'), { recursive: true }).map(String)
  .filter((file) => /^[^/]+\/examples\/[^/]+\.studyflow\.png$/.test(file)).sort();
for (const example of examples) {
  const png = `skills/${example}`;
  sh('node', ['packages/cli/dist/studyflow.mjs', 'convert', '--modeler', png, png]);
}
