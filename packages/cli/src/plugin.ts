import { spawn } from 'node:child_process';
import { accessSync, constants, readdirSync } from 'node:fs';
import path from 'node:path';

/* Companion programs, the way git finds `git-lfs`: `studyflow <name>` runs `studyflow-<name>` from PATH. */

const PREFIX = 'studyflow-';

const pathDirs = (): string[] => (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);

/** Where `binary` sits on PATH, if it is there and executable. */
export function onPath(binary: string): string | undefined {
  for (const dir of pathDirs()) {
    const candidate = path.join(dir, binary);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* not here; keep looking */ }
  }
  return undefined;
}

/** The companion that would serve `studyflow <name>`, if one is installed. */
export const findCompanion = (name: string): string | undefined =>
  /^[a-z][a-z0-9-]*$/i.test(name) ? onPath(`${PREFIX}${name}`) : undefined;

/** Every companion on PATH, by the subcommand each one answers to. */
export function companionNames(): string[] {
  const names = new Set<string>();
  for (const dir of pathDirs()) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      if (entry.startsWith(PREFIX) && entry.length > PREFIX.length && !entry.includes('.')) {
        names.add(entry.slice(PREFIX.length));
      }
    }
  }
  return [...names].sort();
}

/** Hand the rest of the command line over untouched, and adopt the exit code. */
export function runCompanion(binary: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(signal ? 1 : code ?? 0));
  });
}
