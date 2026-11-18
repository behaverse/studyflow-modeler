import { divider, item, material, sectionLabel, space, text } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

export const commandPalette = {
  root: 'relative z-[250] focus:outline-none',
  backdrop: 'fixed inset-0 z-10 bg-black/[0.20]',
  /** The palette grows out of the composer: at the bottom, its search row last, where the composer was, as tall as the
   *  composer and a step wider than any of its editing faces, so it covers the bar it came from. */
  layout: 'fixed inset-0 z-20 flex items-end justify-center p-2 overflow-y-auto',
  panel: `flex flex-col-reverse w-full max-w-[36rem] origin-bottom ${material.sheet}
          duration-200 ease-out closed:transform-[scale(98%)] closed:opacity-0 overflow-hidden`,

  searchRow: `flex items-center gap-3 px-4 h-10 border-t ${divider.edge}`,
  searchIcon: `${ICONS.search} text-stone-500 text-sm shrink-0`,
  searchInput: `flex-1 bg-transparent text-sm ${text.primary} placeholder-stone-400 focus:outline-none`,


  list: 'max-h-[55vh] overflow-y-auto p-1.5',
  empty: 'text-sm text-stone-500 italic py-8 text-center',

  groupLabel: `${sectionLabel} ${space.listLabel}`,

  row: {
    item: `${item.base} cursor-pointer`,
    icon: 'text-base text-stone-500 shrink-0 w-5 text-center',
    label: 'flex-1 truncate',
    hint: '',
  },
  itemActive: item.active,
  itemHint: 'text-[0.6875rem] font-mono text-stone-500 shrink-0',
} as const;
