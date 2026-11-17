import type { AppMode } from '@modeler/app/contexts';
import { button, divider, material, radius, shadow, text } from '@modeler/ui/styles';

/**
 * The top row, over the palette on the left and the inspector on the right: the study's bar, where you are in the
 * study, and what you can do in the app's mode. On a phone, where you are drops to a second row. The row itself takes
 * no clicks, so the canvas between its bars stays reachable.
 */
export const row = {
  band: `fixed top-2 inset-x-2 z-50 grid items-start gap-2 pointer-events-none
         grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]`,
  /** A bar's layout; its material is a panel, or the actions bar's mode tint. */
  bar: 'pointer-events-auto items-center h-10 px-1.5',
  panel: material.panel,
  study: 'flex min-w-0 max-w-full justify-self-start col-start-1 row-start-1',
  trail: 'col-span-2 row-start-2 justify-self-center md:col-span-1 md:col-start-2 md:row-start-1',
  actions: 'flex justify-self-end col-start-2 md:col-start-3 row-start-1',
  fileSlot: 'flex items-center min-w-0',
} as const;

/** The logo is the menu: it opens the command palette. */
export const appMenu = {
  button: `inline-flex items-center gap-1.5 h-7 pl-0.5 pr-1.5 shrink-0 ${radius.button}
           hover:bg-black/[0.05] active:bg-black/[0.08] transition-colors cursor-pointer`,
  logo: 'h-6 w-6',
  /* The app's name beside its logo, where the row has room for it: two lines, as tall as the logo. */
  name: 'hidden lg:block text-xs leading-none text-left whitespace-nowrap text-violet-800',
  nameLight: 'font-light',
  nameBold: 'font-semibold',
  divider: `hidden lg:block mx-1 ${divider.vertical}`,
  caret: `-ml-1 text-[0.6875rem] ${text.secondary}`,
} as const;

export const modeActions = {
  /** A panel while editing; a simulation or a replay tints it the colour of the frame it puts around the canvas. */
  tint: {
    edit: material.panel,
    simulation: `${radius.card} ${shadow.panel} border border-[#efc2e8] bg-[#fbeaf7]`,
    replay: `${radius.card} ${shadow.panel} border border-violet-200 bg-violet-50`,
  } satisfies Record<AppMode, string>,
  /* Hidden on a phone, where the inspector's toggle is all the bar keeps while editing. */
  run: 'hidden sm:flex items-center',
  simulate: `${button.action} rounded-l-lg ${button.accentFill}`,
  runButton: `${button.action} rounded-r-lg ${button.runFill} disabled:cursor-wait`,
  stop: `${button.action} rounded-lg bg-red-700 hover:bg-red-800`,
  exitReplay: `${button.action} rounded-lg bg-violet-600 hover:bg-violet-700`,
  divider: `hidden sm:block mx-1.5 ${divider.vertical}`,
  iconButton: button.icon,
  /** Mirrored: the glyph draws its panel on the left, and the inspector stands on the right. */
  inspectorIcon: 'text-xl -scale-x-100',
  label: 'hidden sm:inline-flex items-center gap-1.5 pl-1.5 pr-2.5 text-sm font-semibold',
  simulationLabel: 'text-[#A32295]',
  replayLabel: 'text-violet-800',
} as const;

export const fileStatus = {
  /* Two lines in the nav bar's height: the file's name over where its edits go. */
  title: `flex flex-col items-start min-w-0 md:max-w-[280px] px-2 py-0.5 ${radius.button}
          text-left hover:bg-black/[0.05] data-[open]:bg-black/[0.08] transition-colors cursor-pointer`,
  name: `flex min-w-0 max-w-full text-xs/4 font-medium ${text.primary}`,
  fileName: 'flex min-w-0 font-mono',
  stem: 'truncate',
  extension: `shrink-0 ${text.muted}`,
  /* No colour of its own: the status takes a tone's, else muted. */
  status: 'flex items-center gap-1 min-w-0 max-w-full text-[0.6875rem]/4 whitespace-nowrap',
  /* Where gives way before how far: the state is the part to keep. */
  where: 'truncate',
  label: 'shrink-0',
  icon: 'shrink-0',
  warning: 'text-amber-700',
  error: 'text-red-700',

  card: `z-[240] w-72 p-3 ${material.menu} [--anchor-gap:6px] focus:outline-none`,
  cardName: `text-xs font-medium break-words ${text.primary}`,
  cardStatus: 'mt-2 flex items-center gap-1.5 text-xs',
  cardText: `mt-1 text-xs ${text.secondary}`,
  actions: 'mt-3 flex flex-wrap gap-1.5',
  primary: `${button.sm} ${button.primary}`,
  secondary: `${button.sm} ${button.secondary}`,
} as const;
