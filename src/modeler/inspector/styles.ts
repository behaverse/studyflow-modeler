export const inspector = {
  wrapper: 'fixed top-0 right-0 z-[60]',
  panel: `relative w-72 rounded-bl-[14px] bg-[#c8bea0]/95 backdrop-blur-2xl
          border border-[#b0a993]/40 border-t-0 border-r-0 border-l-0
          shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.10)]
          text-stone-800 max-h-[calc(100vh-80px)] overflow-y-auto`,
  panelHidden: 'hidden',
  panelBody: 'w-full',

  toggleButton: `absolute top-1.5 right-1.5 z-10 flex items-center justify-center
                 w-6 h-6 rounded-md
                 text-stone-500 hover:text-stone-900 hover:bg-[#b0a993]/25
                 transition-colors`,
  toggleIcon: 'text-[22px]',

  headerTitle: 'pb-0 text-[15px] font-bold p-2 pb-0 text-stone-900',
  headerSubtitle: 'text-[10.5px] text-left font-mono px-2 pb-2 text-stone-500',

  tabList: 'flex flex-wrap gap-1 px-2 pb-2 border-b border-[#b0a993]/40',
  tabBase: 'px-2.5 py-1 text-[12px] font-semibold rounded-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b0a993]',
  tabSelected: 'bg-[#8a8268] text-stone-50 shadow-sm',
  tabUnselected: 'text-stone-600 hover:bg-[#b0a993]/40 hover:text-stone-900 cursor-pointer',
  tabPanels: 'p-1',
  tabPanel: 'rounded-xl',
} as const;

export const field = {
  field: 'mx-2 pb-2',

  label: 'flex items-center justify-between',
  helpAnchor: 'relative group/help',
  helpIcon: 'iconify bi--patch-question text-stone-500 cursor-help',
  helpTooltip: 'absolute bottom-full right-0 mb-1 invisible group-hover/help:visible w-64 bg-stone-700 text-xs text-stone-300 p-2 rounded-lg shadow-xl z-50',
  helpTooltipWide: 'absolute bottom-full right-0 mb-1 invisible group-hover/help:visible max-w-md w-64 bg-stone-700 text-xs text-stone-300 p-2 rounded-lg shadow-xl z-50',
  helpTooltipName: 'font-mono text-xs font-bold text-white',

  textInput: 'px-2 py-1 w-full rounded-md border border-[#b0a993]/40 bg-[#dcd4b8] font-mono text-sm/6 text-stone-800 placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-[#b0a993]',
  textArea: 'px-2 py-1 w-full rounded-md border border-[#b0a993]/40 bg-[#dcd4b8] font-mono text-sm/4 text-stone-800 placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-[#b0a993]',

  selectWrapper: 'relative',
  select: 'appearance-none px-2 py-1 pr-8 w-full rounded-md border border-[#b0a993]/40 bg-[#dcd4b8] text-sm/6 text-stone-800 focus:outline-2 focus:-outline-offset-2 focus:outline-[#b0a993]',
  selectChevron: 'group iconify bi--caret-down pointer-events-none absolute top-1.5 right-2.5',

  booleanRow: 'flex items-center justify-between',
  booleanGroup: 'flex items-center gap-2',
  checkbox: 'group block size-4 rounded border border-[#b0a993]/60 bg-[#dcd4b8] data-[checked]:bg-violet-800 data-[checked]:border-violet-800',
  checkboxIcon: 'stroke-white opacity-0 group-data-[checked]:opacity-100',
} as const;

export const codeEditor = {
  openButton: 'w-full mt-2 p-1 rounded-md cursor-pointer bg-[#b0a993]/40 hover:bg-[#b0a993]/60 text-stone-800 hover:text-stone-900 border border-[#b0a993]/40 transition-colors',
  modalOverlay: 'fixed inset-0 z-150 flex items-center justify-center p-4 backdrop-blur-xs',
  modalBackdrop: 'absolute',
  modal: 'relative z-160 bg-stone-100 rounded-2xl shadow-lg w-full max-w-4xl max-h-[90vh] overflow-auto',
  modalHeader: 'px-4 py-2 flex justify-between items-center',
  modalTitle: 'text-lg font-medium',
  modalClose: 'text-sm text-slate-500',
  modalSection: 'p-4',
  modalSubLabel: 'block text-sm font-medium mb-2',
  modalLanguageSelect: 'appearance-none p-2 w-full rounded-md border-none text-sm text-black/50 bg-stone-200',
  modalEditorFrame: 'w-full h-[40vh] max-h-[50vh] overflow-auto rounded-lg bg-stone-200 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-stone-600',
  modalEditor: 'min-h-full font-mono text-sm/6 text-black',
  modalActions: 'p-4 flex justify-end gap-2',
  modalCancelBtn: 'px-2 py-1 rounded cursor-pointer',
  modalSaveBtn: 'px-3 py-1 bg-sky-500 hover:bg-sky-600 text-white rounded-md cursor-pointer',
} as const;
