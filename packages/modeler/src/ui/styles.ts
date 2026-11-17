export const surface = {
  canvas: 'bg-cream-50',
  chrome: 'bg-cream-100',
  sheet: 'bg-cream-100',
  menu: 'bg-cream-300',
  card: 'bg-cream-200',
} as const;

export const shadow = {
  panel: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]',
  menu: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.10)]',
  sheet: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_24px_72px_rgba(0,0,0,0.16)]',
} as const;

export const border = {
  hairline: 'border border-black/[0.08]',
  /** Controls (inputs, selects, checkboxes) need >=3:1 against their surface
      (WCAG 1.4.11); the hairline is for panels and dividers, which are exempt. */
  control: 'border border-black/[0.45]',
} as const;

/** One tooltip material everywhere; callers add size, padding and positioning. */
export const tooltip = 'bg-stone-900 text-cream-50 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.18)]';

/* Type scale, small end: 11 (micro-labels, hints, badges), 12 (tooltips, help),
   14 (body, items, inputs), 16 (titles). No fractional sizes: adjacent steps
   closer than ~25% stop reading as different sizes. Icon glyphs are exempt.
   Tints: hover bg-black/[0.05], active/selected bg-black/[0.08]. */

export const text = {
  primary: 'text-stone-900',
  secondary: 'text-stone-700',
  muted: 'text-stone-500',
} as const;

export const radius = {
  pill: 'rounded-full',
  capsule: 'rounded-2xl',
  card: 'rounded-xl',
  button: 'rounded-lg',
  field: 'rounded-md',
  /** Off-scale on purpose: 10px is the concentric fit inside the palette wrapper's `card` radius. */
  paletteTool: 'rounded-[0.625rem]',
} as const;

/*
 * The chrome's design language. Four materials: a panel floats over the canvas (the nav bar's bars and trail, the
 * palette, the inspector, the context pad, the minimap, the replay bar, a notice), a menu opens from one (popups,
 * flyouts, the file card, dropdown lists), a sheet takes the page (dialogs, the command palette), and a field sits in
 * any of them. One hairline draws every edge and rule, one blue ring every focus, and "selected" is always the dark
 * fill of a primary button.
 */
export const material = {
  panel: `${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panel}`,
  menu: `${radius.card} ${surface.menu} ${border.hairline} ${shadow.menu}`,
  sheet: `${radius.capsule} ${surface.sheet} ${border.hairline} ${shadow.sheet}`,
} as const;

/** The hairline as a rule between things: across a bar, or under a header. */
export const divider = {
  vertical: 'w-px h-4 shrink-0 bg-black/[0.08]',
  horizontal: 'h-px bg-black/[0.08]',
  /** The colour alone, for a `border-b` or `border-t` that rules off a section. */
  edge: 'border-black/[0.08]',
} as const;

/** One focus ring for every field and control. */
export const focusRing = 'focus:outline-2 focus:-outline-offset-2 focus:outline-[hsl(205,100%,45%)]';

/** Small caps over a group of rows or a menu. */
export const sectionLabel = 'text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-stone-500';

/** A row in a list or a menu: the palette's commands, popup items, Settings' sections. Hover and active tints as above. */
export const item = {
  base: `flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 ${radius.button} text-sm ${text.secondary} transition-colors`,
  hover: 'hover:bg-black/[0.05] hover:text-stone-900',
  active: 'bg-black/[0.08] text-stone-900',
} as const;

/** One of a few choices side by side: the inspector's tabs, the gallery's shelves, the Save dialog's destinations. */
export const choice = {
  base: `inline-flex items-center justify-center gap-1.5 h-7 px-2 ${radius.button} text-xs font-medium transition-colors cursor-pointer`,
  idle: 'text-stone-600 hover:bg-black/[0.05] hover:text-stone-900',
  selected: 'bg-stone-900 text-cream-50',
} as const;

export const button = {
  /** Layout and type of the app's primary actions, as on the nav bar's Simulate and Run. */
  action: `inline-flex items-center justify-center gap-1.5 h-7 px-3.5 text-sm font-semibold
           text-white transition-colors cursor-pointer disabled:opacity-50`,
  /** The accent fill those actions carry. Kept apart from `action` so a state can swap just this. */
  accentFill: 'bg-[#C028B0] hover:bg-[#A32295]',
  /** Run's fill, the logo's violet. */
  runFill: 'bg-[#520BBF] hover:bg-[#4309A2]',

  /** The two sizes of a labelled button: `md` in a dialog or Settings, `sm` in a menu or on a bar. */
  md: 'inline-flex items-center justify-center gap-1.5 h-8 px-3 shrink-0 text-sm font-medium',
  sm: 'inline-flex items-center justify-center gap-1.5 h-7 px-2.5 shrink-0 text-xs font-medium',
  /** The colours, one per kind, each with its size above. */
  primary: `${radius.button} bg-stone-900 hover:bg-stone-800 text-cream-50 transition-colors cursor-pointer disabled:opacity-50`,
  secondary: `${radius.button} ${border.hairline} bg-cream-200 hover:bg-cream-300 ${text.secondary} hover:text-stone-900
              transition-colors cursor-pointer disabled:opacity-50`,
  danger: `${radius.button} border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 hover:text-red-900
           transition-colors cursor-pointer disabled:opacity-50`,
  /** A glyph alone, in a bar, a pad or a title. */
  icon: `inline-flex items-center justify-center h-7 w-7 shrink-0 ${radius.button} ${text.muted}
         enabled:hover:text-stone-900 enabled:hover:bg-black/[0.05] enabled:active:bg-black/[0.08]
         enabled:cursor-pointer disabled:opacity-30 transition-colors`,
} as const;

export const dialog = {
  root: 'relative z-[240] focus:outline-none',
  backdrop: 'fixed inset-0 z-10 w-screen overflow-y-auto bg-black/[0.20]',
  centerLayout: 'flex min-h-full items-center justify-center p-2 sm:p-4',

  panel: `${material.sheet} p-5 sm:p-6 md:p-7 duration-300 ease-out closed:transform-[scale(95%)] closed:opacity-0 z-[102]
          flex flex-col max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)]`,
  panelSm: 'w-full max-w-md',
  panelMd: 'w-full max-w-2xl',
  panelLg: 'w-full max-w-4xl',
  panelXl: 'w-full max-w-6xl',
  panelFull: 'w-full max-w-none h-[calc(100vh-1rem)] sm:h-[calc(100vh-2rem)]',
  panelBody: 'flex-1 min-h-0 overflow-y-auto -mx-1 px-1',

  title: 'text-base tracking-tight text-stone-900 font-semibold',
  closeButton: `${button.icon} -my-1`,
  titleAction: 'text-sm/6 text-stone-500 enabled:hover:text-stone-900 enabled:cursor-pointer disabled:opacity-30 transition-colors',

  body: 'text-sm text-stone-600',
  bodyLink: 'text-stone-900 underline hover:no-underline',

  label: 'text-sm font-medium text-stone-800',
  input: `mt-2 block w-full ${radius.field} ${border.control} ${surface.card} py-1.5 px-2.5 font-mono text-sm/6 text-stone-900 ${focusRing}`,
  helpText: 'text-xs text-stone-500 mt-1.5',

  primaryBtn: `${button.md} ${button.primary}`,
  previewBtn: `${button.md} ${radius.button} bg-emerald-600 hover:bg-emerald-700 text-white transition-colors`,

  statusText: 'text-sm text-stone-600 m-auto',
} as const;
