import type { Face } from '@modeler/composer/face';
import { button, chip, divider, item, material, radius, sectionLabel, shadow, space } from '@modeler/ui/styles';

/** The box every control shares; `words` or `glyph` fills it, so no class here is overridden by another. */
const box = `inline-flex items-center justify-center gap-1.5 h-7 shrink-0 ${radius.button} transition-colors cursor-pointer
             disabled:cursor-default disabled:opacity-40`;
/** A control that says its action. */
const words = 'px-2.5 text-sm font-medium';
/** A control that shows a glyph alone, square. */
const glyph = 'w-7 text-base';
const accentFill = 'bg-accent enabled:hover:bg-accent-hover text-white';
const raised = `border border-black/[0.14] bg-field enabled:hover:bg-white text-stone-700 enabled:hover:text-stone-900
                shadow-[0_1px_1px_rgba(0,0,0,0.05)]`;
const quiet = 'text-stone-500 enabled:hover:text-stone-900 enabled:hover:bg-black/[0.05]';
/** A context the bar shows, not an action: the selection, the plan's problems. */
const token = `${space.token} ${radius.button} ring-1`;

/**
 * The composer's controls: one family on every face, as a Mac toolbar's are, 28px tall on the 40px bar, one corner and
 * one type size. A face has at most one `primary`, filled in the accent (Simulate, a transport's play, Accept); its
 * other actions are `secondary`, a raised field (Run, Stop, Close, Discard, Open file), and a transport's other steps
 * `quietIcon`. A face in a mode names it with `label`, in the mode's colour, the colour of its frame round the canvas.
 */
export const control = {
  primary: `${box} ${words} ${accentFill}`,
  primaryIcon: `${box} ${glyph} ${accentFill}`,
  secondary: `${box} ${words} ${raised}`,
  quiet: `${box} ${words} ${quiet}`,
  quietIcon: `${box} ${glyph} ${quiet}`,
  label: 'inline-flex items-center gap-1.5 h-7 pl-1.5 pr-1 shrink-0 text-sm font-semibold',
  /** Each mode's colour, as its label wears it. */
  mode: {
    playback: 'text-[#93367f]',
    replay: 'text-[#5b3fc0]',
    review: 'text-[#2f7a50]',
  },
} as const;

export const composer = {
  /** At the bottom of the canvas, over it like the other panels. Its width eases from face to face, and a mode's
   *  tint fades in, so a change of face reads as the same bar turning, not a new one. */
  root: `fixed bottom-2 left-1/2 -translate-x-1/2 z-50 flex items-center min-h-10 px-[5px] max-w-[calc(100vw-1rem)]
         transition-[width,background-color,border-color] duration-200 ease-out`,
  width: {
    home: 'w-[34rem]',
    design: 'w-[30rem]',
    selection: 'w-[34rem]',
    playback: 'w-[19rem]',
    replay: 'w-[50rem]',
    review: 'w-[34rem]',
  } satisfies Record<Face, string>,
  /** A panel; a simulation or a replay tints it the colour of the frame it puts round the canvas. */
  tint: {
    home: material.panel,
    design: material.panel,
    selection: material.panel,
    playback: `${radius.card} ${shadow.panel} border border-[#efc2e8] bg-[#fbf3f9]`,
    replay: `${radius.card} ${shadow.panel} border border-[#dcd0fa] bg-[#f7f4fe]`,
    review: `${radius.card} ${shadow.panel} border border-[#c5e3d0] bg-[#f3faf6]`,
  } satisfies Record<Face, string>,
  /** A face's contents, faded in with a short rise each time the face changes. */
  face: 'flex items-center gap-1 w-full min-w-0 motion-safe:animate-[composer-in_180ms_ease-out]',

  /** Reads as the composer's field, and opens the palette out of it. */
  prompt: `flex items-center gap-2 flex-1 min-w-0 h-7 px-2.5 ${radius.button} text-sm text-stone-400 text-left
           hover:bg-black/[0.03] cursor-text transition-colors`,
  promptText: 'flex-1 truncate',
  kbd: 'shrink-0 font-mono text-[0.6875rem] text-stone-400',
  divider: `${divider.vertical} mx-0.5`,

  /** What the commands act on: the selection, as a chip the way AI apps attach context, in the accent the selection
   *  wears everywhere (its outline, the pad, the inspector's header). */
  chip: `${chip.base} max-w-[12rem]`,
  chipName: 'truncate font-mono',
  chipClear: chip.clear,

  start: control.secondary,
  /** Opens and closes the views' drawer under the canvas; held down while it is open. */
  views: `${control.quietIcon} aria-pressed:bg-black/[0.08] aria-pressed:text-stone-900`,
  /** ▶ simulates: the design faces' one primary, where an AI app puts send. */
  play: control.primaryIcon,
  /** The real run, in the runner: secondary, since it leaves the modeler. */
  run: `${control.secondary} max-sm:hidden`,
  label: `${control.label} ${control.mode.playback}`,
  /** The simulation's transport: play or pause is the face's primary, in the place ▶ had; a step is quiet. */
  playPause: control.primaryIcon,
  transport: control.quietIcon,
  stop: control.secondary,

  problems: `${token} bg-amber-50 ring-amber-200 text-amber-800 hover:bg-amber-100 cursor-pointer`,
  /** Nothing to fix: a quiet check where the count would be. */
  ready: 'inline-flex items-center justify-center size-7 shrink-0 text-base text-emerald-600',
  problemsCard: `z-[240] w-80 max-h-72 overflow-y-auto ${space.list} ${material.menu} ${space.anchor} focus:outline-none`,
  problemsHeader: `${sectionLabel} ${space.listLabel}`,
  problemsFooter: `flex justify-end gap-1.5 px-1.5 pt-2 pb-0.5 mt-1 border-t ${divider.edge}`,
  /** Run's question, over the composer's right end, where Run sits. */
  runCard: `absolute bottom-full right-0 mb-1.5 z-[240] w-80 max-h-72 overflow-y-auto ${space.list} ${material.menu}`,
  cancel: `${button.base} ${button.secondary}`,
  runAnyway: `${button.base} ${button.primary}`,
  /** A row: the problem, which shows its element, and its fix beside it. */
  problem: 'flex items-start gap-1',
  problemShow: `${item.base} flex-1 min-w-0 items-start ${item.hover} cursor-pointer text-left`,
  problemText: 'line-clamp-2',
  fix: `inline-flex items-center h-6 px-2 shrink-0 mt-1 mr-1 text-xs font-medium ${button.secondary}`,
  warning: 'mt-0.5 shrink-0 text-amber-700',
  error: 'mt-0.5 shrink-0 text-red-700',
} as const;
