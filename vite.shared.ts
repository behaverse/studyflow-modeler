import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* What the three Vite apps (the modeler, the browser runner, the CLI) share: the repo's one version, the source
 * aliases, the assets diagrams are, and the deployment target. */

export const ROOT = import.meta.dirname

/** The repo's one version, from the root package.json; every app and the CLI binary carry it as APP_VERSION. */
export const VERSION: string = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version
export const define = { 'import.meta.env.APP_VERSION': JSON.stringify(VERSION) }

/** The deployment a build is for, named by Vite's mode: `npm run build -- --mode desktop` (and `dev:desktop`) is the
 * desktop app `studyflow edit` serves, shipped with the CLI; the default modes (production for build, development for
 * dev) are the webapp, the baseline, released by the deploy workflow. Each has its style on top of the baseline in
 * assets/css/<target>.css. */
const TARGETS = ['webapp', 'desktop']
const DEFAULT_MODES = ['production', 'development']
function target(mode: string): string {
  if (![...TARGETS, ...DEFAULT_MODES].includes(mode)) throw new Error(`--mode must be one of ${TARGETS.join(', ')}, not "${mode}".`)
  return TARGETS.includes(mode) ? mode : 'webapp'
}

/** Workspace packages are consumed as TypeScript source: the same table as tsconfig.json `paths`.
 * `@import '#target.css'` in a stylesheet brings in the target's style. */
export const aliases = (mode: string) => [
  { find: '@core', replacement: resolve(ROOT, 'packages/core/src') },
  { find: '@canvas', replacement: resolve(ROOT, 'packages/canvas/src') },
  { find: '@modeler', replacement: resolve(ROOT, 'packages/modeler/src') },
  { find: '@runner', replacement: resolve(ROOT, 'skills/browser/src') },
  { find: '@cli', replacement: resolve(ROOT, 'packages/cli/src') },
  { find: '@skills', replacement: resolve(ROOT, 'skills') },
  { find: '#assets', replacement: resolve(ROOT, 'assets') },
  { find: '#target.css', replacement: resolve(ROOT, 'assets/css', `${target(mode)}.css`) },
]

/** Diagrams and their pictures are assets, imported as URLs. */
export const assetsInclude = [
  '**/*.png', '**/*.bpmn', '**/*.studyflow', '**/*.jpeg', '**/*.gif',
  '**/*.svg', '**/*.ico', '**/*.webp', '**/*.yaml',
]
