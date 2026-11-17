import { divider, item, material, radius, sectionLabel, text } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

export const commandPalette = {
  root: 'relative z-[250] focus:outline-none',
  backdrop: 'fixed inset-0 z-10 bg-black/[0.20]',
  layout: 'fixed inset-0 z-20 flex items-start justify-center pt-[15vh] p-4 overflow-y-auto',
  panel: `w-full max-w-lg ${material.sheet}
          duration-200 ease-out closed:transform-[scale(98%)] closed:opacity-0 overflow-hidden`,

  searchRow: `flex items-center gap-3 px-4 h-12 border-b ${divider.edge}`,
  searchIcon: `${ICONS.search} text-stone-500 text-sm shrink-0`,
  searchInput: `flex-1 bg-transparent text-sm ${text.primary} placeholder-stone-400 focus:outline-none`,
  githubLink: 'text-stone-400 hover:text-stone-900 text-base shrink-0 transition-colors focus:outline-none focus-visible:text-stone-900',


  list: 'max-h-[55vh] overflow-y-auto p-1.5',
  empty: 'text-sm text-stone-500 italic py-8 text-center',

  groupLabel: `${sectionLabel} px-2.5 pt-2.5 pb-1`,

  // Two layouts for one item shape: list rows, and the File group's tile row up top.
  row: {
    item: `${item.base} cursor-pointer`,
    icon: 'text-base text-stone-500 shrink-0 w-5 text-center',
    label: 'flex-1 truncate',
    hint: '',
  },
  tile: {
    wrap: 'flex gap-1.5 px-1.5 pb-1',
    // h-[4.5rem]: exactly two list rows (36px each); the hint sits in the corner to keep it there.
    item: `relative flex-1 min-w-0 h-[4.5rem] flex flex-col items-center justify-center gap-1 px-2 ${radius.button}
           text-sm ${text.secondary} cursor-pointer transition-colors`,
    icon: 'text-2xl leading-none text-stone-600',
    label: 'w-full text-xs leading-tight text-center truncate',
    hint: 'absolute top-1.5 right-2',
  },
  itemActive: item.active,
  itemHint: 'text-[0.6875rem] font-mono text-stone-500 shrink-0',
} as const;
