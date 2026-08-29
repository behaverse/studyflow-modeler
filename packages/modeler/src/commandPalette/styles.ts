import { surface, shadow, text, radius } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

export const commandPalette = {
  root: 'relative z-[250] focus:outline-none',
  backdrop: 'fixed inset-0 z-10 backdrop-blur',
  layout: 'fixed inset-0 z-20 flex items-start justify-center pt-[15vh] p-4 overflow-y-auto',
  panel: `w-full max-w-lg ${radius.capsule} ${surface.sheet} border border-black/[0.06] ${shadow.sheet}
          duration-200 ease-out closed:transform-[scale(98%)] closed:opacity-0 overflow-hidden`,

  searchRow: 'flex items-center gap-3 px-4 h-12 border-b border-black/[0.06]',
  searchIcon: `${ICONS.search} text-stone-500 text-sm shrink-0`,
  searchInput: `flex-1 bg-transparent text-sm ${text.primary} placeholder-stone-400 focus:outline-none`,

  breadcrumbRow: 'px-3 py-1.5 text-[11px] text-stone-500 flex items-center gap-2 border-b border-black/[0.04]',
  breadcrumbBack: 'hover:text-stone-900 inline-flex items-center gap-1',
  breadcrumbDivider: 'text-stone-300',
  breadcrumbLabel: 'text-stone-700 font-medium',

  list: 'max-h-[55vh] overflow-y-auto p-1.5',
  empty: 'text-sm text-stone-500 italic py-8 text-center',

  groupLabel: 'text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-500 px-3 pt-2.5 pb-1',

  item: `flex items-center gap-3 w-full text-left px-3 py-2 ${radius.button}
         text-sm ${text.secondary} cursor-pointer transition-colors`,
  itemActive: 'bg-black/[0.08] text-stone-900',
  itemIcon: 'text-[16px] text-stone-500 shrink-0 w-5 text-center',
  itemLabel: 'flex-1 truncate',
  itemHint: 'text-[11px] font-mono text-stone-500 shrink-0',
  itemChevron: `${ICONS.chevronRight} text-stone-500 text-[11px] ml-1`,
} as const;
