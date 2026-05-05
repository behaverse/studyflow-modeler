// Node-level Tailwind classnames. Per-node components compose these into
// their layout; the Executor shell provides the surrounding chrome.

export const nodeStyles = {
  // Generic centered card for non-fullscreen nodes (start/end/instruction/etc.)
  card: 'flex flex-col items-center justify-center min-h-full bg-stone-50 px-6 py-10 overflow-y-auto',
  panel: 'w-full max-w-2xl bg-white rounded-lg shadow-sm border border-stone-200 p-6 flex flex-col gap-4',
  title: 'text-2xl font-semibold text-stone-900',
  subtitle: 'text-sm text-stone-500',
  body: 'text-stone-800 whitespace-pre-wrap leading-relaxed',
  actions: 'flex gap-3 justify-end pt-2',
  primaryButton:
    'bg-fuchsia-800 hover:bg-fuchsia-900 text-white text-sm font-medium px-4 py-2 rounded transition-colors',
  secondaryButton:
    'bg-stone-200 hover:bg-stone-300 text-stone-800 text-sm font-medium px-4 py-2 rounded transition-colors',
  destructiveButton:
    'bg-red-700 hover:bg-red-800 text-white text-sm font-medium px-4 py-2 rounded transition-colors',
  // Behaverse / fullscreen iframe surface
  behaverseStage: 'relative flex-1 bg-black h-full w-full',
  behaverseIframe: 'absolute inset-0 w-full h-full border-0',
  behaverseCover:
    'absolute inset-0 flex items-center justify-center bg-black/85 text-white text-sm transition-opacity duration-300',
  behaverseCoverHidden: 'opacity-0 pointer-events-none',
  behaverseCoverShown: 'opacity-100',
  // Form bits for questionnaire
  formItem: 'flex flex-col gap-2 border-b border-stone-100 pb-3 last:border-b-0',
  formPrompt: 'text-sm text-stone-800',
  scaleRow: 'flex flex-wrap gap-2',
  scaleOption:
    'cursor-pointer flex items-center gap-2 px-3 py-1.5 border border-stone-200 rounded text-xs hover:bg-stone-50',
  scaleOptionSelected: 'bg-fuchsia-50 border-fuchsia-300 text-fuchsia-900',
  textarea:
    'w-full min-h-[120px] border border-stone-300 rounded p-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-fuchsia-300',
  // Consent panel
  consentBox:
    'border border-stone-200 rounded p-4 bg-stone-50 max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed',
  // End-stage code/redirect display
  codeBlock: 'font-mono bg-stone-900 text-emerald-300 px-3 py-2 rounded text-sm break-all',
  redirectInfo: 'text-sm text-stone-600',
} as const;
