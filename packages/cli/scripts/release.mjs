/**
 * `npm run release:cli` — the CLI release, end to end, from this machine; nothing in CI writes to the repository.
 *
 * Bump `version` in packages/cli/package.json, then run it: it builds every platform (writing Formula/studyflow.rb
 * from the same build, so the checksums match), commits those two files, tags, pushes, and creates the GitHub
 * release with the tarballs. Needs a clean tree otherwise, `bun`, and `gh` logged in.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(cliDir, '../..');
const { version } = JSON.parse(readFileSync(resolve(cliDir, 'package.json'), 'utf8'));
const tag = `v${version}`;
const releaseDir = resolve(cliDir, 'dist/release');
const RELEASE_FILES = ['packages/cli/package.json', 'Formula/studyflow.rb'];

const raw = (command, args) => execFileSync(command, args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const out = (command, args) => raw(command, args).trim();
const sh = (command, args) => execFileSync(command, args, { cwd: repoDir, stdio: 'inherit' });
const fail = (message) => { console.error(message); process.exit(1); };

if (out('git', ['branch', '--show-current']) !== 'main') fail('Release from main.');
if (out('git', ['tag', '-l', tag]) || out('git', ['ls-remote', '--tags', 'origin', tag])) {
  fail(`${tag} exists already — bump version in packages/cli/package.json first.`);
}
// The binaries are built from the working tree, so anything uncommitted would ship untagged.
const dirty = raw('git', ['status', '--porcelain']).split('\n').filter(Boolean)  // untrimmed: `XY path`, X may be a space
  .filter((line) => !RELEASE_FILES.includes(line.slice(3)));
if (dirty.length) fail(`Commit or stash first — only the version bump may be pending:\n${dirty.join('\n')}`);

sh('npm', ['run', 'package', '-w', '@behaverse/studyflow-cli']);
const assets = readdirSync(releaseDir).filter((name) => /\.tar\.gz(\.sha256)?$/.test(name)).map((name) => resolve(releaseDir, name));
if (assets.length < 2) fail(`No release assets in ${releaseDir}.`);

sh('git', ['add', ...RELEASE_FILES]);
sh('git', ['commit', '-m', `studyflow ${tag}`]);
sh('git', ['tag', tag]);
sh('git', ['push', 'origin', 'main', tag]);
sh('gh', ['release', 'create', tag, '--title', tag, '--generate-notes', '--verify-tag', ...assets]);
console.log(`\n${tag} is out. Users: brew upgrade studyflow (or the install lines in the README).`);
