export type LogKind = 'info' | 'task' | 'ok' | 'error' | 'skip';

export const layout = {
  page: 'flex flex-col h-screen',
  title: 'font-semibold text-stone-900 text-sm leading-tight',
  badge: 'text-[10px] uppercase bg-stone-200 text-stone-700 rounded px-2 py-0.5',
  meta: 'text-[10px] uppercase tracking-wide text-stone-500',
  body: 'relative flex flex-1 min-h-0',
  stage: 'relative flex-1 bg-black',
  cover: 'absolute inset-0 flex items-center justify-center bg-black/85 text-white text-sm transition-opacity duration-300',
  coverShown: 'opacity-100',
  // Floating logs toggle: always visible above iframe content, top-right of the
  // stage. Sidebar (z-10) covers it when open — that's fine, the sidebar has
  // its own close button.
  logsToggle: 'absolute top-3 right-3 z-20 text-[11px] uppercase tracking-wide bg-black/70 hover:bg-black/85 text-white rounded px-2.5 py-1 backdrop-blur transition-colors shadow-md',
  sidebar: 'absolute top-0 right-0 bottom-0 w-80 bg-stone-100 border-l border-stone-300 overflow-y-auto p-3 text-sm shadow-lg transition-transform duration-200 z-10',
  sidebarOpen: 'translate-x-0',
  sidebarClosed: 'translate-x-full',
  // Sidebar header now hosts the study identity (title/phase/seed) that used
  // to live in the navbar.
  sidebarHeader: 'flex items-start justify-between gap-2 mb-3 pb-2 border-b border-stone-300',
  sidebarInfo: 'flex flex-col gap-1 min-w-0',
  sidebarInfoMetaRow: 'flex items-center gap-2 flex-wrap',
  sidebarClose: 'text-stone-500 hover:text-stone-800 text-lg leading-none shrink-0',
  sidebarList: 'space-y-1',
  helpPage: 'p-6 max-w-xl mx-auto',
  helpTitle: 'text-2xl font-semibold mb-3',
  helpText: 'mb-4 text-stone-700',
  helpExample: 'bg-stone-100 p-3 text-xs mt-4',
  uploadButton: 'inline-flex items-center gap-2 cursor-pointer bg-fuchsia-800 hover:bg-fuchsia-900 text-white text-sm font-medium px-4 py-2 rounded transition-colors',
  uploadInput: 'sr-only',
} as const;

export const logColor: Record<LogKind, string> = {
  info: 'text-stone-700',
  task: 'text-blue-700',
  ok: 'text-emerald-700',
  error: 'text-red-700',
  skip: 'text-amber-700',
};
