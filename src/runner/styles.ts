export type LogKind = 'info' | 'task' | 'ok' | 'error';

export const layout = {
  page: 'flex flex-col h-screen',
  header: 'bg-fuchsia-700 text-white px-4 py-2 flex items-center gap-3',
  title: 'font-semibold',
  badge: 'text-xs uppercase bg-white/20 rounded px-2 py-0.5',
  meta: 'text-xs opacity-75',
  body: 'flex flex-1 min-h-0',
  iframe: 'flex-1 bg-black border-0',
  sidebar: 'w-80 bg-stone-100 border-l border-stone-300 overflow-y-auto p-3 text-sm',
  sidebarTitle: 'font-semibold mb-2',
  sidebarList: 'space-y-1',
  helpPage: 'p-6 max-w-xl mx-auto',
  helpTitle: 'text-2xl font-semibold mb-3',
  helpText: 'mb-4 text-stone-700',
  helpExample: 'bg-stone-100 p-3 text-xs',
} as const;

export const logColor: Record<LogKind, string> = {
  info: 'text-stone-700',
  task: 'text-fuchsia-700',
  ok: 'text-emerald-700',
  error: 'text-red-700',
};
