import { divider, material, radius, sectionLabel, space } from '@modeler/ui/styles';

export const palette = {
  /* Centred in the band below the top row, not in the whole viewport: centred on the
     viewport, the palette sits under the brand on any window shorter than ~500px
     (a laptop with the dock showing, a half-height split). `top`/`bottom` +
     `h-fit` + `my-auto` centres it in what is left.
     ponytail: no scroll cap on the band. The flyouts and tooltips are absolutely
     positioned children, so `overflow-y-auto` here clips them. Under ~440px of
     window height the tools spill past the band; portal the flyouts out
     first if that ever needs fixing. */
  wrapper: `fixed left-2 top-14 bottom-2 my-auto h-fit z-[210] flex flex-col
            ${material.panel} ${space.barInset} gap-1`,

  separator: `my-1 mx-1 ${divider.horizontal}`,

  groupWithFlyout: 'group/palgroup relative flex items-center',

  toolButton: `flex items-center justify-center
               size-7 ${radius.paletteTool}
               text-stone-600 cursor-grab
               hover:bg-black/[0.05] hover:text-stone-900
               active:bg-black/[0.08]
               transition-colors`,

  /** The pins and the +, below the kinds. */
  stack: 'flex flex-col gap-1',

  /** The +: the one filled tool, in the accent, since it opens everything the others do not show. */
  addButton: `flex items-center justify-center size-7 ${radius.paletteTool}
              bg-accent text-white hover:bg-accent-hover aria-expanded:bg-accent-hover
              cursor-pointer transition-colors`,

  /** A kind's flyout, marked as a tool group is: a small triangle in the tool's corner, clear of its glyph. */
  groupMark: `pointer-events-none absolute right-[2px] bottom-[2px] size-1 bg-stone-500 group-hover/palgroup:bg-stone-800
              [clip-path:polygon(100%_0,100%_100%,0_100%)]`,

} as const;

export const paletteFlyout = {
  panel: (isOpen: boolean) => `${isOpen ? 'visible opacity-100 pointer-events-auto' : 'invisible opacity-0 pointer-events-none'}
              transition-opacity duration-150
              absolute left-[calc(100%+0.75rem)] top-[-0.375rem] z-[300]
              w-[18.5rem]
              p-1.5
              ${material.menu}`,

  /** Without this the flyout closes as the cursor crosses the gap from its button. */
  gapBridge: 'absolute left-[-0.75rem] top-0 w-[0.75rem] h-full',

  /** A popup menu's header: 40 tall, edge to edge over the panel's padding, its letters 16 in. */
  header: `${sectionLabel} flex items-center gap-1.5 h-10 -mx-1.5 -mt-1.5 mb-1.5 px-4 border-b ${divider.edge}`,

  /** The tiles, and the skills' under a rule: one scroll for both. */
  body: 'max-h-56 overflow-y-auto overflow-x-hidden overscroll-contain palette-flyout-scroll',
  grid: 'grid grid-cols-3 gap-1',
  rule: `my-1.5 mx-1 ${divider.horizontal}`,

  item: 'touch-pan-y select-none flex flex-col items-center justify-center gap-1 px-1 py-2 rounded-md text-stone-700 hover:text-stone-900 hover:bg-black/[0.05] active:bg-black/[0.08] transition-colors cursor-grab active:cursor-grabbing min-w-0',

  /* Wide enough for the longest shipped name on one line ("Questionnaire"); a longer one breaks rather than clips. */
  itemLabel: 'text-xs leading-tight text-center text-pretty break-words w-full',
} as const;
