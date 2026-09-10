import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* What the Vite apps (the modeler, the browser runner, the CLI) share: the repo's one
 * version, the source aliases, and the assets diagrams are. One build serves the webapp and the desktop app alike: the
 * desktop app tells itself apart at runtime (assets/css/desktop.css). */

export const ROOT = import.meta.dirname

/** The repo's one version, from the root package.json; every app and the CLI binary carry it as APP_VERSION. */
export const VERSION: string = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version
export const define = { 'import.meta.env.APP_VERSION': JSON.stringify(VERSION) }

/** Workspace packages are consumed as TypeScript source: the same table as tsconfig.json `paths`. */
export const aliases = [
  { find: '@core', replacement: resolve(ROOT, 'packages/core/src') },
  { find: '@canvas', replacement: resolve(ROOT, 'packages/canvas/src') },
  { find: '@modeler', replacement: resolve(ROOT, 'packages/modeler/src') },
  { find: '@runner', replacement: resolve(ROOT, 'skills/browser/src') },
  { find: '@cli', replacement: resolve(ROOT, 'packages/cli/src') },
  { find: '@desktop', replacement: resolve(ROOT, 'packages/desktop') },
  { find: '@skills', replacement: resolve(ROOT, 'skills') },
  { find: '#assets', replacement: resolve(ROOT, 'assets') },
]

/** Diagrams and their pictures are assets, imported as URLs. */
export const assetsInclude = [
  '**/*.png', '**/*.bpmn', '**/*.studyflow', '**/*.jpeg', '**/*.gif',
  '**/*.svg', '**/*.ico', '**/*.webp', '**/*.yaml',
]
