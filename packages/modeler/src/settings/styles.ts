import { surface, shadow, text, radius } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

export const settingsView = {
  root: `fixed inset-0 z-[300] flex bg-black/40 backdrop-blur-xs
         p-0 sm:p-4 md:p-8 md:px-12 lg:p-12 lg:px-24 xl:p-16 xl:px-48`,
  panel: `flex flex-1 flex-col overflow-hidden ${surface.sheet}
          rounded-none sm:rounded-2xl
          border-0 sm:border sm:border-black/[0.08] ${shadow.sheet}`,

  header: `flex items-center gap-2 px-3 h-14 shrink-0 border-b border-black/[0.06] ${surface.sheet}`,
  headerTitle: `text-[15px] font-semibold tracking-tight ${text.primary}`,
  backButton: `flex items-center justify-center w-8 h-8 ${radius.field}
                ${text.muted} hover:text-stone-900 hover:bg-black/[0.05]
                active:bg-black/[0.08] transition-colors cursor-pointer`,
  backIcon: `${ICONS.arrowLeft} text-[16px]`,

  body: 'flex flex-col sm:flex-row flex-1 min-h-0',

  sidebar: `shrink-0 ${surface.sheet}
            overflow-x-auto sm:overflow-y-auto
            border-b sm:border-b-0 sm:border-r border-black/[0.06]
            w-full sm:w-48 md:w-60
            px-2 sm:px-3 py-2 sm:py-4`,
  sidebarList: 'flex flex-row gap-0.5 sm:flex-col',
  sidebarItem: `flex items-center gap-2.5 text-left px-3 py-1.5 ${radius.button}
                text-[13px] font-medium ${text.secondary}
                whitespace-nowrap sm:whitespace-normal sm:w-full
                hover:bg-black/[0.05] hover:text-stone-900 active:bg-black/[0.08]
                transition-colors cursor-pointer`,
  sidebarItemActive: 'bg-black/[0.05] text-stone-900',
  sidebarItemIcon: 'text-[15px] text-stone-500 shrink-0',

  content: 'flex-1 overflow-y-auto px-4 py-5 sm:px-5 sm:py-6 md:px-6 md:py-8',
  contentInner: 'mx-auto max-w-2xl space-y-6 sm:space-y-8',

  sectionTitle: `text-[22px] font-semibold tracking-tight ${text.primary}`,
  sectionDescription: `text-[13px] ${text.muted} mt-1`,

  row: 'flex items-start justify-between gap-6 py-4 border-b border-black/[0.06] last:border-b-0',
  rowText: 'flex-1 min-w-0',
  rowLabel: `text-[14px] font-medium ${text.primary}`,
  rowHelp: `text-[12.5px] ${text.muted} mt-0.5 leading-relaxed`,
  rowControl: 'shrink-0 flex items-center',

  group: `${radius.card} ${surface.card} border border-black/[0.06] px-4 py-1`,

  inlineBtn: `${radius.button} bg-cream-200 hover:bg-cream-300 active:bg-cream-400
              border border-black/[0.06] py-1.5 px-3 text-[14px] ${text.secondary}
              hover:text-stone-900 transition-colors cursor-pointer`,
  inlineBtnDanger: `${radius.button} bg-red-50 hover:bg-red-100 active:bg-red-200
                    border border-red-200 py-1.5 px-3 text-[13px] text-red-700
                    hover:text-red-900 transition-colors cursor-pointer`,

  select: `appearance-none px-2.5 py-1 pr-8 ${radius.field}
           border border-black/[0.08] bg-cream-100 text-[13px] text-stone-900
           focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400 cursor-pointer`,
  selectWrapper: 'relative',
  selectChevron: `${ICONS.caretDown} pointer-events-none absolute top-2.5 right-2 text-stone-500 text-[12px]`,

  textInput: `px-2.5 py-1.5 w-72 max-w-full ${radius.field}
              border border-black/[0.08] bg-cream-100 font-mono text-[13px] text-stone-900
              placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400`,

  switchTrack: `relative flex h-5 w-9 cursor-pointer ${radius.pill}
                bg-cream-300 p-0.5 transition-colors
                data-[checked]:bg-stone-900 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400`,
  switchThumb: `pointer-events-none inline-block size-4 ${radius.pill} bg-cream-50 shadow ring-0
                transition duration-200 ease-in-out
                translate-x-0 group-data-[checked]:translate-x-4`,

  valueChip: `inline-flex items-center gap-1.5 px-2 py-0.5 ${radius.field}
              bg-cream-200 border border-black/[0.06] text-[12px] font-medium ${text.secondary}`,
} as const;
