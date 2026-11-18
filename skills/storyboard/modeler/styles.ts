import { material } from '@modeler/ui/styles';

export const storyboard = {
  /** Over the canvas, which it stands in for, between the top row and the composer; clear of the inspector (inline). */
  root: 'fixed top-16 left-2 z-[40] overflow-auto bg-desk',
  head: 'flex items-center gap-3 px-2 pb-3 text-sm text-stone-600',
  total: 'text-base font-semibold text-stone-900',
  fill: `inline-flex items-center h-7 px-3 rounded-md border border-black/[0.16] bg-field hover:bg-white text-sm font-medium
         text-stone-700 hover:text-stone-900 cursor-pointer transition-colors`,
  strip: 'flex flex-wrap items-stretch gap-y-4 px-2 pb-6',
  /** A step: what it is, what the participant does, how long; the selected one opens its fields. */
  card: `flex flex-col w-60 min-h-32 ${material.panel} text-left cursor-pointer transition-shadow`,
  cardSelected: 'ring-2 ring-accent/50',
  /** A start, an end, a choice: a bookend narrower than a step. */
  marker: `flex flex-col justify-center w-36 min-h-32 px-3 py-2 rounded-xl border border-dashed border-black/[0.18]
           text-left cursor-pointer text-stone-600`,
  markerSelected: 'border-solid border-accent/60 bg-accent/[0.05]',
  top: 'flex items-center gap-2 px-3 pt-2.5 text-xs text-stone-500',
  glyph: 'text-base text-stone-600',
  name: 'px-3 pt-1 text-sm font-semibold text-stone-900 line-clamp-2',
  unnamed: 'px-3 pt-1 text-sm text-stone-400',
  description: 'px-3 pt-1 text-xs text-stone-600 line-clamp-3',
  length: 'mt-auto px-3 pt-2 pb-2.5 text-xs font-medium text-stone-700',
  noLength: 'mt-auto px-3 pt-2 pb-2.5 text-xs text-stone-400',
  /** Between two steps: the way on, and a + that puts a step there. */
  join: 'flex items-center justify-center w-10 shrink-0 text-stone-400',
  plus: `flex items-center justify-center size-6 rounded-full bg-paper border border-black/[0.12] text-stone-500
         hover:bg-accent hover:text-white hover:border-accent cursor-pointer transition-colors`,
} as const;
