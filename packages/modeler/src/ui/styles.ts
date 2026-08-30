export const surface = {
  canvas: 'bg-cream-50',
  chrome: 'bg-cream-100/72 backdrop-blur-2xl backdrop-saturate-150',
  sheet: 'bg-cream-100',
  menu: 'bg-cream-300/85 backdrop-blur-2xl backdrop-saturate-150',
  card: 'bg-cream-200',
} as const;

export const shadow = {
  panel: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.6)]',
  panelFlat: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]',
  menu: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.6)]',
  sheet: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_24px_72px_rgba(0,0,0,0.16)]',
} as const;

export const border = {
  hairline: 'border border-black/[0.08]',
  /** Controls (inputs, selects, checkboxes) need >=3:1 against their surface
      (WCAG 1.4.11) -- the hairline is for panels and dividers, which are exempt. */
  control: 'border border-black/[0.45]',
} as const;

/** Focus indicator: the canvas selection blue (>=3:1 on cream), not cream-on-cream. */
export const focus = {
  ring: 'focus:outline-2 focus:-outline-offset-2 focus:outline-[hsl(205,100%,45%)]',
  within: 'focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-[hsl(205,100%,45%)]',
} as const;

/** One tooltip material everywhere; callers add size, padding and positioning. */
export const tooltip = 'bg-stone-900/90 backdrop-blur-md text-cream-50 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.18)]';

/* Type scale, small end: 11 (micro-labels, hints, badges), 12 (tooltips, help),
   14 (body, items, inputs), 16 (titles). No fractional sizes -- adjacent steps
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

export const dialog = {
  root: 'relative z-[240] focus:outline-none',
  backdrop: 'fixed backdrop-blur inset-0 z-10 w-screen overflow-y-auto',
  centerLayout: 'flex min-h-full items-center justify-center p-2 sm:p-4',

  panel: `${radius.capsule} ${surface.sheet} border border-black/[0.06] p-5 sm:p-6 md:p-7 ${shadow.sheet} duration-300 ease-out closed:transform-[scale(95%)] closed:opacity-0 z-[102]
          flex flex-col max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)]`,
  panelSm: 'w-full max-w-md',
  panelMd: 'w-full max-w-2xl',
  panelLg: 'w-full max-w-4xl',
  panelXl: 'w-full max-w-6xl',
  panelBody: 'flex-1 min-h-0 overflow-y-auto -mx-1 px-1',

  title: 'text-base tracking-tight text-stone-900 font-semibold',
  closeButton: 'text-sm/6 text-stone-500 hover:text-stone-900 ml-2 float-end cursor-pointer transition-colors',
  titleAction: 'text-sm/6 text-stone-500 enabled:hover:text-stone-900 enabled:cursor-pointer disabled:opacity-30 transition-colors',

  body: 'text-sm text-stone-600',
  bodyLink: 'text-stone-900 underline hover:no-underline',

  fieldset: 'space-y-6',
  label: 'text-sm font-medium text-stone-800',
  input: `mt-2 block w-full ${radius.button} ${border.control} ${surface.card} py-2 px-3 font-mono text-sm/6 text-stone-900 focus:outline-2 focus:-outline-offset-2 focus:outline-[hsl(205,100%,45%)]`,
  helpText: 'text-xs text-stone-500 mt-1.5',

  primaryBtn: `${radius.button} bg-stone-900 hover:bg-stone-800 py-1.5 px-3.5 text-sm/6 text-cream-50 font-medium transition-colors cursor-pointer`,
  previewBtn: `inline-flex items-center gap-2 ${radius.button} bg-emerald-600 hover:bg-emerald-700 py-1.5 px-3.5 text-sm/6 text-white font-medium transition-colors`,

  statusText: 'text-sm text-stone-600 m-auto',
} as const;
