import { surface, shadow, border, radius } from '@/modeler/ui/styles';

export const palette = {
  wrapper: `fixed top-1/2 -translate-y-1/2 left-2 z-[210] flex flex-col
            ${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panel}
            py-1 px-1 gap-0.5`,

  separator: 'my-1 h-px bg-black/[0.08] mx-1',

  group: 'group relative flex items-center',
  groupWithFlyout: 'group/palgroup relative flex items-center',

  toolButton: `flex items-center justify-center
               w-[34px] h-8 ${radius.paletteTool}
               text-stone-600 cursor-grab
               hover:bg-black/[0.05] hover:text-stone-900
               hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.6)]
               active:bg-black/[0.08]
               transition-all`,

  groupChevron: 'absolute right-[3px] top-1/2 w-[3px] h-[3px] border-r-[1.4px] border-b-[1.4px] border-stone-600 rotate-[-45deg] -translate-y-1/2',

  tooltip: `pointer-events-none absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2
            bg-stone-900/85 backdrop-blur-md text-cream-50 text-[11.5px] font-medium
            px-2.5 py-1 rounded-lg whitespace-nowrap
            opacity-0 group-hover:opacity-100 transition-opacity
            z-[200]`,
} as const;

export const paletteFlyout = {
  panel: (isOpen: boolean) => `${isOpen ? 'visible opacity-100 pointer-events-auto' : 'invisible opacity-0 pointer-events-none'}
              transition-opacity duration-150
              absolute left-[calc(100%+10px)] top-[-6px] z-[300]
              w-[272px]
              p-2.5 pb-3
              ${radius.card} ${surface.menu} ${border.hairline} ${shadow.menu}`,

  /** Without this the flyout closes as the cursor crosses the gap from its button. */
  gapBridge: 'absolute left-[-10px] top-0 w-[10px] h-full',

  header: 'text-xs font-semibold uppercase tracking-[0.1em] text-stone-500 pb-2 mb-2 px-1 border-b border-black/[0.08]',

  sectionHeader: 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-stone-400 px-1 mt-2 mb-1 first:mt-0',

  extBadge: 'inline-flex items-center px-1.5 py-px rounded text-[9.5px] font-semibold uppercase tracking-[0.1em] bg-transparent text-current border border-current',

  grid: 'grid grid-cols-3 gap-1 max-h-56 overflow-y-auto overflow-x-hidden overscroll-contain palette-flyout-scroll',

  item: 'flex flex-col items-center justify-center gap-1 p-2 rounded-lg text-stone-700 hover:text-stone-900 hover:bg-black/[0.05] active:bg-black/[0.08] transition-colors cursor-grab active:cursor-grabbing min-w-0',

  itemLabel: 'text-xs leading-tight text-center text-pretty hyphens-auto w-full',
} as const;
