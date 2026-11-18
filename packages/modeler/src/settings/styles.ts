import { button, focusRing, radius, space, surface, text, textField } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

export const settingsView = {
  // Inside the shared Modal frame; the sidebar and content share the panel's height.
  body: 'flex flex-col sm:flex-row flex-1 min-h-[60vh] -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 border-t border-black/[0.10]',

  sidebar: `shrink-0 ${surface.sheet}
            overflow-x-auto sm:overflow-y-auto
            border-b sm:border-b-0 sm:border-r border-black/[0.10]
            w-full sm:w-48 md:w-60
            ${space.list}`,
  sidebarList: 'flex flex-row gap-0.5 sm:flex-col',
  sidebarItem: `flex items-center gap-2.5 text-left h-8 px-2.5 ${radius.button}
                text-sm font-medium ${text.secondary}
                whitespace-nowrap sm:whitespace-normal sm:w-full
                hover:bg-black/[0.05] hover:text-stone-900 active:bg-black/[0.08]
                transition-colors cursor-pointer`,
  sidebarItemActive: 'bg-black/[0.08] text-stone-900',
  sidebarItemIcon: 'text-base text-stone-500 shrink-0',

  content: 'flex-1 overflow-y-auto px-4 sm:px-6',
  // The vertical padding is the column's, not the scroller's, so a `sticky top-0` child sticks flush to the top.
  contentInner: 'mx-auto max-w-2xl py-4 sm:py-6 space-y-6',

  sectionTitle: `text-base font-semibold tracking-tight ${text.primary}`,
  sectionDescription: `text-sm ${text.muted} mt-1`,

  row: 'flex items-start justify-between gap-6 py-4 border-b border-black/[0.10] last:border-b-0',
  rowText: 'flex-1 min-w-0',
  rowLabel: `text-sm font-medium ${text.primary}`,
  rowHelp: `text-xs ${text.muted} mt-0.5 leading-relaxed`,
  rowControl: 'shrink-0 flex items-center',

  group: `${radius.card} ${surface.card} border border-black/[0.10] px-4 py-1`,

  inlineBtn: `${button.base} ${button.secondary}`,
  inlineBtnDanger: `${button.base} ${button.danger}`,

  select: textField.select,
  selectWrapper: 'relative',
  selectChevron: `${ICONS.caretDown} ${textField.chevron}`,

  textInput: `w-72 max-w-full font-mono ${textField.input}`,

  switchTrack: `relative flex h-5 w-9 cursor-pointer ${radius.pill}
                bg-black/[0.12] p-0.5 transition-colors
                data-[checked]:bg-accent ${focusRing}`,
  switchThumb: `pointer-events-none inline-block size-4 ${radius.pill} bg-cream-50 shadow ring-0
                transition duration-200 ease-in-out
                translate-x-0 group-data-[checked]:translate-x-4`,

  valueChip: `${space.token} ${radius.field} bg-field border border-black/[0.10] ${text.secondary}`,
} as const;
