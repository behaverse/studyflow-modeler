import { button, divider, item as listItem, material, radius, space, text } from '@modeler/ui/styles';

/**
 * The top row, over the palette on the left and the inspector on the right: the study's bar, where you are in the
 * study, and the inspector's toggle. What you can do lives in the composer at the bottom. On a phone, where you are
 * drops to a second row. The row itself takes no clicks, so the canvas between its bars stays reachable.
 */
export const row = {
  band: `fixed top-2 inset-x-2 z-50 grid items-start gap-2 pointer-events-none
         grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]`,
  /** A bar's layout; its material is a panel. */
  bar: `pointer-events-auto items-center ${space.bar}`,
  panel: material.panel,
  study: 'flex min-w-0 max-w-full justify-self-start col-start-1 row-start-1',
  trail: 'col-span-2 row-start-2 justify-self-center md:col-span-1 md:col-start-2 md:row-start-1',
  actions: 'flex justify-self-end col-start-2 md:col-start-3 row-start-1',
  /** The middle: the trail, and the switch between the flow and a skill's view. */
  middle: 'flex items-center gap-2',
  fileSlot: 'flex items-center min-w-0',
} as const;

/** The logo is the app's menu: the app's own commands (new, open, save, settings, help), and the way to all of them. */
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

  menu: `z-[240] w-60 ${space.list} ${material.menu} ${space.anchor} focus:outline-none`,
  /** A Mac's menu row: the accent under the pointer or the keys, with everything in it white. */
  item: `group ${listItem.base} data-[focus]:bg-accent data-[focus]:text-white cursor-pointer`,
  itemIcon: 'w-4 shrink-0 text-center text-stone-500 group-data-[focus]:text-white',
  itemLabel: 'flex-1',
  itemHint: 'shrink-0 font-mono text-[0.6875rem] text-stone-500 group-data-[focus]:text-white/80',
  separator: `my-1 mx-2 ${divider.horizontal}`,
} as const;

/** The row's right bar, while editing: the inspector's toggle. A simulation or a replay hides the inspector, and the
 *  bar with it; their controls are the composer's. */
export const panels = {
  toggle: button.icon,
  /** Mirrored: the glyph draws its panel on the left, and the inspector stands on the right. */
  inspectorIcon: 'text-xl -scale-x-100',
} as const;

export const fileStatus = {
  /* Two lines in the nav bar's height: the file's name over where its edits go. */
  /** A control of the bar like the others, 28 tall: its two lines, 14 and 12, stand in it. */
  title: `flex flex-col items-start justify-center h-7 min-w-0 md:max-w-[280px] px-2 ${radius.button}
          text-left hover:bg-black/[0.05] data-[open]:bg-black/[0.08] transition-colors cursor-pointer`,
  name: `flex min-w-0 max-w-full text-xs/[14px] font-medium ${text.primary}`,
  /* No colour of its own: the status takes a tone's, else muted. */
  status: 'flex items-center gap-1 min-w-0 max-w-full text-[0.6875rem]/3 whitespace-nowrap',
  /* Where gives way before how far: the state is the part to keep. */
  where: 'truncate',
  label: 'shrink-0',
  icon: 'shrink-0',
  warning: 'text-amber-700',
  error: 'text-red-700',

  card: `z-[240] w-72 ${space.card} ${material.menu} ${space.anchor} focus:outline-none`,
  cardName: `text-sm font-semibold break-words ${text.primary}`,
  cardStatus: 'mt-2 flex items-center gap-1.5 text-xs',
  cardText: `mt-1 text-xs ${text.secondary}`,
  actions: 'mt-3 flex flex-wrap gap-2',
  primary: `${button.base} ${button.primary}`,
  secondary: `${button.base} ${button.secondary}`,
} as const;
