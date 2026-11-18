/** Paper on a desk (`assets/css/app.css`): every panel, menu and sheet is the warm paper, shadows tell them apart, and
 * a field or a card on one is lighter again, as fields are on a Mac. Nothing is pure white, so nothing glares. */
export const surface = {
  canvas: 'bg-desk',
  chrome: 'bg-paper',
  sheet: 'bg-paper',
  menu: 'bg-paper',
  card: 'bg-field',
} as const;

export const shadow = {
  panel: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]',
  menu: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.10)]',
  sheet: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_24px_72px_rgba(0,0,0,0.16)]',
} as const;

export const border = {
  hairline: 'border border-black/[0.10]',
} as const;

/** One tooltip material everywhere; callers add size, padding and positioning. */
export const tooltip = 'bg-stone-900 text-cream-50 rounded-md shadow-[0_2px_8px_rgba(0,0,0,0.18)]';

/** The two tooltips: a label is one short line; help is a paragraph, whose width its caller sets. Both open 6 away. */
export const tip = {
  label: `${tooltip} px-2.5 py-1 text-xs font-medium whitespace-nowrap`,
  help: `${tooltip} p-3 text-xs font-normal normal-case leading-snug`,
} as const;

/* Type scale, macOS's (assets/css/modeler.css): 11 (micro-labels, hints, badges), 12 (tooltips, help),
   13 (body, items, inputs: `text-sm`), 15 (titles: `text-base`). Icon glyphs are exempt.
   Tints: hover bg-black/[0.05], pressed bg-black/[0.08]; a highlighted menu row is the accent. */

/** Soft ink: the darkest text is stone-800, not near-black, for less contrast to read against. */
export const text = {
  primary: 'text-stone-800',
  secondary: 'text-stone-700',
  muted: 'text-stone-500',
} as const;

/** macOS's two radii: 10 for a surface (panel, menu, sheet), 6 for a control (button, field, row, choice). */
export const radius = {
  pill: 'rounded-full',
  card: 'rounded-[10px]',
  button: 'rounded-md',
  field: 'rounded-md',
  /** The concentric fit inside the palette wrapper: its 10px corner less its 4px padding. */
  paletteTool: 'rounded-md',
} as const;

/**
 * The spacing, on a 4px grid (system C of 2026-11-17: compact bars, roomy panels). Every floating thing sits 8 from the
 * window's edge and 8 from the next (`top-2`, `left-2`, `right-2`, `bottom-2`). A bar is 40 tall, with 6 round its 28px
 * controls and 4 between them: 5 of padding inside its 1px hairline, so the 6 holds on every side. A menu or a list pads
 * 6 round its 32px rows, and opens 6 from what opened it. A card, or a panel of content like the inspector, pads 16. A
 * token (a chip, a badge) is 24 tall, a field 32.
 */
export const space = {
  bar: 'h-10 px-[5px] gap-1',
  /** A bar's inset on every side, for one that stands up (the tools) or wraps (the context pad). */
  barInset: 'p-[5px]',
  list: 'p-1.5',
  /** Small caps over a group of a list's rows, its letters in line with theirs. */
  listLabel: 'px-2.5 pt-2 pb-1',
  anchor: '[--anchor-gap:6px]',
  card: 'p-4',
  token: 'inline-flex items-center gap-1 h-6 px-2 shrink-0 text-[0.6875rem] font-medium',
  field: 'h-8 px-2.5',
} as const;

/*
 * The chrome's design language. Four materials: a panel floats over the canvas (the nav bar's bars and trail, the
 * palette, the inspector, the context pad, the minimap, the composer, the views drawer), a menu opens from one (popups,
 * flyouts, the file card, dropdown lists), a sheet takes the page (dialogs, the command palette), and a field sits in
 * any of them. One hairline draws every edge and rule, and one accent every focus ring, highlighted row and default
 * button.
 */
export const material = {
  panel: `${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panel}`,
  menu: `${radius.card} ${surface.menu} ${border.hairline} ${shadow.menu}`,
  sheet: `${radius.card} ${surface.sheet} ${border.hairline} ${shadow.sheet}`,
} as const;

/** The hairline as a rule between things: across a bar, or under a header. */
export const divider = {
  vertical: 'w-px h-4 shrink-0 bg-black/[0.10]',
  horizontal: 'h-px bg-black/[0.10]',
  /** The colour alone, for a `border-b` or `border-t` that rules off a section. */
  edge: 'border-black/[0.10]',
} as const;

/** A chip: what a view is about (the selection, a filter), 24 tall in the accent the selection wears, with a way to let
 *  it go. */
export const chip = {
  base: 'inline-flex items-center gap-1 h-6 pl-2 pr-0.5 shrink-0 rounded-md bg-accent/[0.10] ring-1 ring-accent/30 text-[0.6875rem] font-medium text-accent-ink',
  clear: 'inline-flex items-center justify-center size-5 rounded-md text-accent-ink/70 hover:text-accent-ink hover:bg-accent/[0.12] cursor-pointer',
} as const;

/** One focus ring for every field and control: macOS's soft halo in the accent, round the field's own edge. */
export const focusRing = 'focus:outline-none focus:ring-[3px] focus:ring-accent/30 focus:border-accent/70';

/**
 * A field, wherever it is (the inspector, a dialog, Settings, a skill's panel): 32 tall, 10 in from its edge, on the
 * lighter fill with a soft hairline, and the one focus ring. Its caller sets its width. A select keeps room on the right
 * for its chevron, which sits at the same place in every one.
 */
export const textField = {
  input: `h-8 px-2.5 ${radius.field} border border-black/[0.20] bg-field text-sm text-stone-900 placeholder-stone-400 ${focusRing}`,
  select: `appearance-none h-8 pl-2.5 pr-8 ${radius.field} border border-black/[0.20] bg-field text-sm text-stone-900 ${focusRing} cursor-pointer`,
  chevron: 'pointer-events-none absolute top-1/2 -translate-y-1/2 right-2.5 text-xs text-stone-500',
} as const;

/** Small caps over a group of rows or a menu. */
export const sectionLabel = 'text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-stone-500';

/** A row in a list or a menu: the palette's commands, popup items, Settings' sections. Hover and active tints as above. */
export const item = {
  base: `flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 ${radius.button} text-sm ${text.secondary} transition-colors`,
  hover: 'hover:bg-black/[0.05] hover:text-stone-900',
  /** The highlighted row, as a Mac's menus draw it: the accent, with everything in it white. */
  active: 'bg-accent text-white [&_*]:text-white',
} as const;

/**
 * One of several choices side by side: the inspector's tabs, the gallery's shelves, the Save dialog's destinations. The
 * selected one is raised, as in a Mac's segmented control. On a `track` they read as one control; without one they wrap
 * onto as many rows as they need, so a long list of tabs stays whole.
 */
export const choice = {
  base: `inline-flex items-center justify-center gap-1.5 h-6 px-2.5 ${radius.button} text-xs font-medium transition-colors cursor-pointer`,
  idle: 'text-stone-600 hover:bg-black/[0.04] hover:text-stone-900',
  selected: 'bg-field text-stone-800 shadow-[0_1px_2px_rgba(0,0,0,0.16),0_0_0_0.5px_rgba(0,0,0,0.08)]',
  track: `flex gap-0.5 p-0.5 ${radius.button} bg-black/[0.06]`,
} as const;

export const button = {
  /** A push button, the one size wherever it stands (a bar, a dialog, a card): 28 tall, a word or two. */
  base: 'inline-flex items-center justify-center gap-1.5 h-7 px-3 shrink-0 text-sm font-medium',
  /** The colours, one per kind, each with its size above: the default button is the accent, the others a raised field. */
  primary: `${radius.button} bg-accent hover:bg-accent-hover text-white transition-colors cursor-pointer disabled:opacity-50`,
  secondary: `${radius.button} border border-black/[0.16] bg-field hover:bg-white shadow-[0_1px_1px_rgba(0,0,0,0.06)]
              ${text.secondary} hover:text-stone-900 transition-colors cursor-pointer disabled:opacity-50`,
  danger: `${radius.button} border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 hover:text-red-900
           transition-colors cursor-pointer disabled:opacity-50`,
  /** A glyph alone, in a bar, a pad or a title. */
  icon: `inline-flex items-center justify-center h-7 w-7 shrink-0 ${radius.button} ${text.muted}
         enabled:hover:text-stone-900 enabled:hover:bg-black/[0.05] enabled:active:bg-black/[0.08]
         enabled:cursor-pointer disabled:opacity-30 transition-colors`,
} as const;

/**
 * A dialog, every one alike (`ui/Modal.tsx`): a sheet that pads 24 (16 on a phone); a 28px title row, 16 above what
 * it holds, its actions and window controls the bars' 28px glyphs; a lead line under it; cards and previews that pad 16;
 * and a ruled footer, its buttons on the right, the default one last.
 */
export const dialog = {
  root: 'relative z-[240] focus:outline-none',
  backdrop: 'fixed inset-0 z-10 w-screen overflow-y-auto bg-black/[0.20]',
  centerLayout: 'flex min-h-full items-center justify-center p-2 sm:p-4',

  panel: `${material.sheet} p-4 sm:p-6 duration-300 ease-out closed:transform-[scale(95%)] closed:opacity-0 z-[102]
          flex flex-col max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)]`,
  panelSm: 'w-full max-w-md',
  panelMd: 'w-full max-w-2xl',
  panelLg: 'w-full max-w-4xl',
  panelXl: 'w-full max-w-6xl',
  panelFull: 'w-full max-w-none h-[calc(100vh-1rem)] sm:h-[calc(100vh-2rem)]',

  header: 'flex items-center gap-1 h-7 mb-4 shrink-0',
  title: 'text-base tracking-tight text-stone-900 font-semibold',
  /** The title row's glyphs: a dialog's own actions, then maximize and close. */
  headerButton: button.icon,
  /** A small inline toggle in a dialog's content (the schedule's rows). */
  titleAction: 'text-sm/6 text-stone-500 enabled:hover:text-stone-900 enabled:cursor-pointer disabled:opacity-30 transition-colors',
  lead: `text-sm ${text.muted} mb-4`,

  label: 'text-sm font-medium text-stone-800',
  input: `mt-1.5 block w-full ${textField.input}`,
  helpText: 'text-xs text-stone-500 mt-1.5',
  bodyLink: 'text-stone-900 underline hover:no-underline',

  card: `${radius.card} ${surface.card} ${border.hairline} p-4`,
  /** A picture the dialog shows (a figure, a reporting diagram): on the field's paper, not pure white. */
  preview: `${radius.card} ${surface.card} ${border.hairline} p-4`,
  empty: `text-sm ${text.muted} italic`,
  error: 'text-xs text-red-700',
  checkbox: 'size-3.5 shrink-0 accent-accent cursor-pointer',

  footer: `mt-4 pt-4 border-t ${divider.edge} flex items-center gap-2 shrink-0`,
  primaryBtn: `${button.base} ${button.primary}`,
  secondaryBtn: `${button.base} ${button.secondary}`,
} as const;
