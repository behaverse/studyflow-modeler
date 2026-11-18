import { choice, material } from '@modeler/ui/styles';

/** The drawer's height, which the composer stands above while it is open. */
export const DRAWER_HEIGHT = '17rem';

export const drawer = {
  /** Right of the tools, clear of the inspector (set inline), at the bottom. */
  root: `fixed bottom-2 left-14 z-[45] h-[17rem] max-sm:left-2 flex flex-col ${material.panel}`,
  /** Maximized: a dialog over the app, on a backdrop that puts it back. */
  rootMaximized: `fixed z-[240] inset-x-2 top-2 bottom-2 sm:top-8 sm:bottom-8 sm:left-1/2 sm:right-auto sm:-translate-x-1/2
                  sm:w-[min(68rem,calc(100vw-4rem))] flex flex-col ${material.sheet}`,
  backdrop: 'fixed inset-0 z-[239] bg-black/[0.20]',
  header: 'flex items-center gap-2 px-2 pt-2 pb-1.5 shrink-0',
  tabs: choice.track,
  tab: choice.base,
  tabIdle: choice.idle,
  tabSelected: choice.selected,
  /** The header's window controls: maximize or restore, then close. */
  controls: 'ml-auto flex items-center gap-0.5',
  close: `inline-flex items-center justify-center size-6 rounded-md text-stone-500 hover:text-stone-900
          hover:bg-black/[0.05] cursor-pointer transition-colors`,
  body: 'flex-1 min-h-0 overflow-auto px-3 pb-3',
  /** A view's own line under the tabs: what it counts, and its actions. */
  bar: 'flex items-center gap-3 mb-2 text-xs text-stone-500',
  /** An empty view: what it needs, and the one press that starts it. */
  empty: 'flex flex-col items-start gap-2 pt-2 text-sm text-stone-500',
  emptyAction: 'inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-black/[0.16] bg-field hover:bg-white text-sm font-medium text-stone-700 hover:text-stone-900 cursor-pointer transition-colors',
  /** A row or group of the selected element, in the selection's accent. */
  selected: 'bg-accent/[0.08] ring-1 ring-accent/30',
} as const;
