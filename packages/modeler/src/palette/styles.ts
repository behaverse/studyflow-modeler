import { surface, shadow, border, radius, tooltip as tooltipMaterial } from '@modeler/ui/styles';

export const palette = {
  /* Centred in the band BELOW the top row, not in the whole viewport: centring on
     the viewport put the palette under the brand on any window shorter than ~500px
     (a laptop with the dock showing, a half-height split). `top`/`bottom` +
     `h-fit` + `my-auto` centres it in what is left.
     ponytail: no scroll cap on the band -- the flyouts and tooltips are absolutely
     positioned CHILDREN, so `overflow-y-auto` here clips them. Under ~440px of
     window height the tools spill past the band again; portal the flyouts out
     first if that ever needs fixing. */
  wrapper: `fixed left-2 top-[4.5rem] bottom-2 my-auto h-fit z-[210] flex flex-col
            ${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panel}
            py-1 px-1 gap-0.5`,

  separator: 'my-1 h-px bg-black/[0.08] mx-1',

  group: 'group relative flex items-center',
  groupWithFlyout: 'group/palgroup relative flex items-center',

  toolButton: `flex items-center justify-center
               w-[2.125rem] h-8 ${radius.paletteTool}
               text-stone-600 cursor-grab
               hover:bg-black/[0.05] hover:text-stone-900
               hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.6)]
               active:bg-black/[0.08]
               transition-all`,

  groupChevron: 'absolute right-[0.1875rem] top-1/2 w-[0.1875rem] h-[0.1875rem] border-r-[1.4px] border-b-[1.4px] border-stone-600 rotate-[-45deg] -translate-y-1/2',

  tooltip: `pointer-events-none absolute left-[calc(100%+0.75rem)] top-1/2 -translate-y-1/2
            ${tooltipMaterial} text-xs font-medium
            px-2.5 py-1 whitespace-nowrap
            opacity-0 group-hover:opacity-100 transition-opacity
            z-[200]`,
} as const;

export const paletteFlyout = {
  panel: (isOpen: boolean) => `${isOpen ? 'visible opacity-100 pointer-events-auto' : 'invisible opacity-0 pointer-events-none'}
              transition-opacity duration-150
              absolute left-[calc(100%+0.625rem)] top-[-0.375rem] z-[300]
              w-[17rem]
              p-2.5 pb-3
              ${radius.card} ${surface.menu} ${border.hairline} ${shadow.menu}`,

  /** Without this the flyout closes as the cursor crosses the gap from its button. */
  gapBridge: 'absolute left-[-0.625rem] top-0 w-[0.625rem] h-full',

  header: 'text-xs font-semibold uppercase tracking-[0.1em] text-stone-500 pb-2 mb-2 px-1 border-b border-black/[0.08]',

  sectionHeader: 'text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-stone-500 px-1 mt-2 mb-1 first:mt-0',

  extBadge: 'inline-flex items-center px-1.5 py-px rounded text-[0.6875rem] font-semibold uppercase tracking-[0.1em] bg-transparent text-current border border-current',

  grid: 'grid grid-cols-3 gap-1 max-h-56 overflow-y-auto overflow-x-hidden overscroll-contain palette-flyout-scroll',

  item: 'touch-none select-none flex flex-col items-center justify-center gap-1 p-2 rounded-lg text-stone-700 hover:text-stone-900 hover:bg-black/[0.05] active:bg-black/[0.08] transition-colors cursor-grab active:cursor-grabbing min-w-0',

  itemLabel: 'text-xs leading-tight text-center text-pretty hyphens-auto w-full',
} as const;
