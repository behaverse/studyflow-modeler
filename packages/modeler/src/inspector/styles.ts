import { surface, shadow, border, radius } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

export const inspector = {
  wrapper: 'fixed top-2 right-2 z-[220]',
  /** Width is set inline (see `inspector/panelWidth`): drag-resizable, so size is state, not a class. */
  panel: `relative ${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panelFlat}
          text-stone-900 max-h-[calc(100vh-80px)] overflow-y-auto`,
  panelHidden: 'hidden',
  panelBody: 'w-full',

  resizeHandle: `absolute top-0 bottom-0 left-0 w-1.5 -translate-x-1/2 z-10 cursor-col-resize touch-none
                 focus:outline-none group/resize
                 after:absolute after:inset-y-3 after:left-1/2 after:w-px after:-translate-x-1/2
                 after:bg-stone-900/0 hover:after:bg-stone-900/20 focus-visible:after:bg-stone-900/40
                 after:transition-colors`,

  toggleButton: `fixed top-3.5 right-3.5 z-[230] flex items-center justify-center
                 w-8 h-8 rounded-md
                 text-stone-500 hover:text-stone-900 hover:bg-black/[0.05]
                 transition-colors`,
  toggleIcon: 'text-[24px]',

  headerTitle: 'pb-0 text-[15px] font-semibold p-2 pb-0 text-stone-900 tracking-tight',
  headerSubtitle: 'text-[10.5px] text-left font-mono px-2 pb-2 text-stone-500',

  tabList: 'flex flex-wrap gap-0.5 px-2 pb-2 border-b border-black/[0.08]',
  tabBase: 'px-1.5 py-1 text-xs font-semibold rounded-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-400',
  tabSelected: 'bg-stone-900 text-cream-50 shadow-sm',
  tabUnselected: 'text-stone-600 hover:bg-black/[0.05] hover:text-stone-900 cursor-pointer',
  tabPanels: 'p-1',
  tabPanel: 'rounded-xl',
} as const;

export const field = {
  field: 'mx-2 pb-2',

  label: 'flex items-center justify-between text-sm font-semibold',
  labelActions: 'flex items-center gap-1',
  labelAddBtn: 'w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-stone-900 hover:bg-black/[0.05] cursor-pointer',
  /** Flex rather than inline: baseline alignment left the `?` two pixels above the `+`. */
  helpAnchor: 'relative inline-flex items-center justify-center w-5 h-5 group/help',
  helpIcon: `${ICONS.help} text-base text-stone-400 cursor-help`,
  helpTooltip: 'fixed w-48 bg-stone-900 text-xs text-cream-200 p-2 rounded-lg shadow-xl z-[260]',
  helpTooltipWide: 'fixed w-64 bg-stone-900 text-xs text-cream-200 p-2 rounded-lg shadow-xl z-[260]',
  helpTooltipName: 'font-mono text-xs font-bold text-cream-50',

  textInput: 'px-2 py-1 w-full rounded-md border border-black/[0.08] bg-cream-200 font-mono text-sm/6 text-stone-900 placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',
  textArea: 'px-2 py-1 w-full rounded-md border border-black/[0.08] bg-cream-200 font-mono text-sm/4 text-stone-900 placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',

  selectWrapper: 'relative',
  select: 'appearance-none px-2 py-1 pr-8 w-full rounded-md border border-black/[0.08] bg-cream-200 text-sm/6 text-stone-900 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',
  selectChevron: 'group iconify bi--caret-down pointer-events-none absolute top-1.5 right-2.5 text-stone-500',

  comboInput: 'appearance-none px-2 py-1 pr-8 w-full rounded-md border border-black/[0.08] bg-cream-200 font-mono text-sm/6 text-stone-900 placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',
  comboChevronBtn: 'absolute top-0 right-0 h-full w-7 flex items-center justify-center text-stone-500 hover:text-stone-900 cursor-pointer',
  comboChevronIndicator: 'pointer-events-none absolute top-0 right-0 h-full w-7 flex items-center justify-center text-stone-500',
  comboChevronIcon: `${ICONS.caretDown} text-[12px]`,
  comboOptions: 'z-[240] mt-1 w-[var(--input-width)] max-h-56 overflow-auto rounded-md border border-black/[0.08] bg-cream-100 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.10)] py-1 focus:outline-none [--anchor-gap:4px]',
  comboOption: 'px-2.5 py-1 text-sm/6 text-stone-800 data-[focus]:bg-black/[0.05] data-[selected]:font-semibold cursor-pointer',
  comboOptionHint: 'block text-xs/4 font-normal text-stone-500',

  listboxBtn: 'appearance-none px-2 py-1 pr-8 w-full text-left rounded-md border border-black/[0.08] bg-cream-200 text-sm/6 text-stone-900 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400 cursor-pointer',
  listboxOptions: 'z-[240] mt-1 w-[var(--button-width)] max-h-56 overflow-auto rounded-md border border-black/[0.08] bg-cream-100 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.10)] py-1 focus:outline-none [--anchor-gap:4px]',
  labelMenuOptions: 'z-[240] mt-1 min-w-48 max-w-[min(20rem,calc(100vw-2rem))] w-max max-h-56 overflow-auto rounded-md border border-black/[0.08] bg-cream-100 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.10)] py-1 focus:outline-none [--anchor-gap:4px]',

  booleanRow: 'flex items-center justify-between',
  booleanGroup: 'flex items-center gap-2',
  checkbox: 'group block size-4 rounded border border-black/[0.20] bg-cream-200 data-[checked]:bg-stone-900 data-[checked]:border-stone-900',
  checkboxIcon: 'stroke-cream-50 opacity-0 group-data-[checked]:opacity-100',

  arrayList: 'flex flex-col gap-1 mt-1',
  arrayRow: 'relative',
  arrayInput: 'px-2 py-1 pr-7 w-full rounded-md border border-black/[0.08] bg-cream-200 font-mono text-sm/6 text-stone-900 placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',
  arrayRemoveBtn: 'absolute top-1/2 right-1.5 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-stone-900 hover:bg-black/[0.05] cursor-pointer',
  arrayInferredInput: 'px-2 py-1 pr-16 w-full rounded-md border border-dashed border-black/[0.20] bg-cream-100 font-mono italic text-sm/6 text-stone-500 placeholder-stone-400 focus:outline-none focus:border-black/[0.45]',
  arrayInferredLabel: 'pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 italic text-[11.5px] text-stone-400',

  dataFlowRow: 'flex items-center gap-1.5',
  /* Names wrap rather than truncate: an ellipsis eats exactly the name suffix a reader scans for. */
  dataFlowFixed: 'flex-1 min-w-0 px-2 py-1 bg-transparent font-mono text-sm/6 text-stone-600 break-words',
  dataFlowBindInput: 'flex-1 min-w-0 px-2 py-1 bg-black/[0.03] font-mono text-sm/6 text-stone-900 placeholder-stone-400 focus:outline-none resize-none [field-sizing:content] break-words',
  dataFlowEquals: 'shrink-0 self-start py-1 px-0.5 font-mono text-sm/6 text-stone-400 select-none',
  dataFlowValue: 'flex-1 min-w-0 px-2 py-1 rounded-md border border-dashed border-black/[0.20] bg-cream-100 font-mono italic text-sm/6 text-stone-500 break-words',
  dataFlowScoped: 'flex flex-col',
  dataFlowScope: 'px-2 italic text-[11px] text-stone-400 truncate',

  stateRow: 'flex items-stretch rounded-md border border-black/[0.08] bg-cream-200 overflow-hidden focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-cream-400',
  stateNameInput: 'flex-1 min-w-0 px-2 py-1 bg-transparent border-0 font-mono text-sm/6 text-stone-900 placeholder-stone-400 focus:outline-none',
  stateTypeField: 'relative shrink-0 flex items-stretch w-[8rem] border-l border-black/[0.08] bg-black/[0.03] focus-within:bg-black/[0.05]',
  stateTypeInput: 'w-full min-w-0 pl-2 pr-6 py-1 bg-transparent border-0 font-mono text-sm/6 text-stone-600 placeholder-stone-400 placeholder:italic focus:outline-none',
  stateTypeChevronBtn: 'absolute top-0 right-0 h-full w-5 flex items-center justify-center text-stone-500 hover:text-stone-900 cursor-pointer',
  stateTypeChevron: `${ICONS.caretDown} shrink-0 text-[11px] text-stone-500`,
  stateTypeOptions: 'z-[240] mt-1 w-max min-w-[var(--input-width)] max-w-[15rem] max-h-56 overflow-auto rounded-md border border-black/[0.08] bg-cream-100 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.10)] py-1 focus:outline-none [--anchor-gap:4px]',
  stateTypeOption: 'px-2.5 py-1 font-mono text-[13px] text-stone-800 truncate data-[focus]:bg-black/[0.05] data-[selected]:font-semibold cursor-pointer',
  stateTypeUntyped: 'font-sans italic text-stone-400',
  stateTypeNew: 'font-sans text-stone-500',
  stateRemoveBtn: 'shrink-0 w-7 flex items-center justify-center border-l border-black/[0.08] text-stone-400 hover:text-stone-900 hover:bg-black/[0.05] cursor-pointer',
} as const;

export const codeEditor = {
  openButton: 'w-full mt-2 p-1.5 rounded-md cursor-pointer bg-cream-200 hover:bg-cream-300 text-stone-700 hover:text-stone-900 border border-black/[0.08] transition-colors',
  // Overlay sits above the inspector, its toggle, and the Headless UI dialog root (z-[220] to z-[250]).
  modalOverlay: 'fixed inset-0 z-[260] flex items-center justify-center p-2 sm:p-4 md:p-6 backdrop-blur-xs',
  modalBackdrop: 'absolute inset-0',
  modal: `relative z-[270] bg-cream-100 ${radius.capsule} ${shadow.sheet} border border-black/[0.06]
          flex flex-col
          w-full max-w-6xl
          h-[min(92vh,900px)] max-h-[92vh]`,
  modalHeader: 'px-4 sm:px-5 py-3 flex justify-between items-center border-b border-black/[0.06] shrink-0',
  modalTitle: 'text-[15px] font-semibold tracking-tight text-stone-900',
  modalClose: 'text-sm text-stone-500 hover:text-stone-800 cursor-pointer',
  modalBody: 'flex-1 min-h-0 flex flex-col overflow-y-auto',
  modalSection: 'px-4 sm:px-5 py-3',
  modalSectionGrow: 'px-4 sm:px-5 py-3 flex-1 min-h-0 flex flex-col',
  modalSubLabel: 'block text-sm font-medium mb-2 text-stone-700',
  modalLanguageSelect: 'appearance-none p-2 w-full rounded-md border border-black/[0.08] text-sm text-stone-800 bg-cream-200',
  modalEditorFrame: 'flex-1 min-h-[200px] w-full overflow-auto rounded-lg bg-cream-200 border border-black/[0.06] focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-cream-400',
  modalEditor: 'min-h-full font-mono text-sm/6 text-stone-900',
  modalActions: 'px-4 sm:px-5 py-3 flex justify-end gap-2 border-t border-black/[0.06] shrink-0',
  modalCancelBtn: 'px-3 py-1.5 rounded-lg cursor-pointer text-stone-700 hover:bg-black/[0.05]',
  modalSaveBtn: 'px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-cream-50 rounded-lg cursor-pointer font-medium',
} as const;
