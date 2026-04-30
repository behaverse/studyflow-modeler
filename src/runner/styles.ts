export type LogKind = 'info' | 'task' | 'ok' | 'error';

export const layout = {
  page: 'flex flex-col h-screen',
  header: 'bg-fuchsia-900 text-white px-4 py-2 flex items-center gap-3',
  title: 'font-semibold',
  badge: 'text-xs uppercase bg-white/20 rounded px-2 py-0.5',
  meta: 'text-xs opacity-75',
  body: 'relative flex flex-1 min-h-0',
  stage: 'relative flex-1 bg-black',
  iframe: 'absolute inset-0 w-full h-full border-0',
  cover: 'absolute inset-0 flex items-center justify-center bg-black/85 text-white text-sm transition-opacity duration-300',
  coverHidden: 'opacity-0 pointer-events-none',
  coverShown: 'opacity-100',
  logsToggle: 'ml-auto text-xs uppercase bg-white/15 hover:bg-white/25 rounded px-2 py-0.5 transition-colors',
  sidebar: 'absolute top-0 right-0 bottom-0 w-80 bg-stone-100 border-l border-stone-300 overflow-y-auto p-3 text-sm shadow-lg transition-transform duration-200 z-10',
  sidebarOpen: 'translate-x-0',
  sidebarClosed: 'translate-x-full',
  sidebarHeader: 'flex items-center justify-between mb-2',
  sidebarTitle: 'font-semibold',
  sidebarClose: 'text-stone-500 hover:text-stone-800 text-lg leading-none',
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
};
