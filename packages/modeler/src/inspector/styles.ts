import { button, choice, dialog, divider, material, radius, sectionLabel, space, surface, textField, tip } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

/** A field's box: the hairline, the field's fill, and the focus ring round all it holds. */
const box = 'flex items-stretch border border-black/[0.20] bg-field overflow-hidden focus-within:ring-[3px] focus-within:ring-accent/30 focus-within:border-accent/70';

export const inspector = {
  /* Under the nav bar's row, as the palette is on the left. */
  wrapper: 'fixed top-14 right-2 z-[220]',
  /** Width is set inline (see `inspector/panelWidth`): drag-resizable, so size is state, not a class. */
  panel: `relative ${material.panel} text-stone-900 max-h-[calc(100vh-4rem)] overflow-y-auto`,
  panelHidden: 'hidden',
  panelBody: 'w-full',
  /** The tabs' fields in a fieldset, so a review makes every one read-only at once: none of a fieldset's own frame. */
  fields: 'm-0 p-0 border-0 min-w-0',

  resizeHandle: `absolute top-0 bottom-0 left-0 w-1.5 -translate-x-1/2 z-10 cursor-col-resize touch-none
                 focus:outline-none group/resize
                 after:absolute after:inset-y-3 after:left-1/2 after:w-px after:-translate-x-1/2
                 after:bg-stone-900/0 hover:after:bg-stone-900/20 focus-visible:after:bg-stone-900/40
                 after:transition-colors`,

  headerTitle: 'flex items-center gap-1.5 text-base font-semibold px-4 pt-4 text-stone-900 tracking-tight',
  /** The selection's accent: the same as its outline on the canvas and the composer's chip. */
  selectedDot: 'size-2 shrink-0 rounded-full bg-accent',
  headerName: 'min-w-0 truncate',
  headerSubtitle: 'text-[0.6875rem] text-left font-mono px-4 pb-2 text-stone-500',
  /** A review's note, in the colour of what it marks as changed on the canvas. */
  headerReview: 'px-4 pb-2 -mt-1 text-xs text-amber-800',

  tabList: `flex flex-wrap gap-1 px-4 pb-3 border-b ${divider.edge}`,
  tabBase: `${choice.base} focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/30`,
  tabSelected: choice.selected,
  tabUnselected: choice.idle,
  /** 16 round the fields, with each field's own 8 aside (`field.field`). */
  tabPanels: 'px-2 pt-4 pb-1',
  tabPanel: radius.card,
} as const;

/* ponytail: inspector fields wear a 0.20 border, under the 3:1 control minimum. The field fill, the label
   and the focus ring identify them; darken if audited. */
export const field = {
  /** `group/field`: a field's help icon shows while the field is hovered or holds the focus. */
  field: 'group/field mx-2 pb-3',

  label: 'flex items-center justify-between mb-1.5 text-sm font-semibold',
  labelActions: 'flex items-center gap-1',
  labelAddBtn: 'w-5 h-5 flex items-center justify-center rounded text-stone-500 hover:text-stone-900 hover:bg-black/[0.05] cursor-pointer',
  /** Flex rather than inline: baseline alignment left the `?` two pixels above the `+`. */
  helpAnchor: `relative inline-flex items-center justify-center w-5 h-5
               opacity-0 group-hover/field:opacity-100 group-focus-within/field:opacity-100 transition-opacity`,
  helpIcon: `${ICONS.help} text-base text-stone-500 cursor-help`,
  helpTooltip: `fixed w-48 ${tip.help} z-[260]`,
  helpTooltipWide: `fixed w-64 ${tip.help} z-[260]`,
  helpTooltipName: 'font-mono text-xs font-bold text-cream-50',

  unit: 'ml-1 text-xs text-stone-500',
  /** An attribute a Parameters object sets: dashed and dimmed, with the lock by its name, so it reads as not editable here. */
  overriddenLabel: 'flex items-center gap-1',
  overriddenInput: 'block min-h-8 px-2.5 py-[5px] w-full rounded-md border border-dashed border-black/[0.30] bg-black/[0.04] font-mono text-sm/5 text-stone-700 cursor-not-allowed',
  overriddenNote: 'mt-1 px-1 text-[0.6875rem]/4 text-stone-600',
  overriddenSource: 'font-semibold text-stone-800 underline decoration-dotted underline-offset-2 hover:text-stone-950 cursor-pointer',
  /** A field's text: 32 tall on one line (5 + 20 + 5, inside the hairline), taller as `WrapInput` wraps it. */
  textInput: 'block min-h-8 px-2.5 py-[5px] w-full rounded-md border border-black/[0.20] bg-field font-mono text-sm/5 text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-[3px] focus:ring-accent/30 focus:border-accent/70',
  /** What makes a `WrapInput` grow with its text rather than scroll it. */
  wrap: 'resize-none overflow-hidden [field-sizing:content] break-words',
  textArea: 'px-2.5 py-1.5 w-full rounded-md border border-black/[0.20] bg-field font-mono text-sm/5 text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-[3px] focus:ring-accent/30 focus:border-accent/70',

  selectWrapper: 'relative',
  select: 'appearance-none h-8 px-2.5 pr-8 w-full rounded-md border border-black/[0.20] bg-field text-sm text-stone-900 focus:outline-none focus:ring-[3px] focus:ring-accent/30 focus:border-accent/70',
  selectChevron: `${ICONS.caretDown} pointer-events-none absolute top-1/2 -translate-y-1/2 right-2.5 text-stone-500`,

  comboInput: 'appearance-none h-8 px-2.5 pr-8 w-full rounded-md border border-black/[0.20] bg-field font-mono text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-[3px] focus:ring-accent/30 focus:border-accent/70',
  comboChevronBtn: 'absolute top-0 right-0 h-full w-7 flex items-center justify-center text-stone-500 hover:text-stone-900 cursor-pointer',
  comboChevronIndicator: 'pointer-events-none absolute top-0 right-0 h-full w-7 flex items-center justify-center text-stone-500',
  comboChevronIcon: `${ICONS.caretDown} text-xs`,
  comboOptions: `z-[240] w-[var(--input-width)] max-h-56 overflow-auto ${material.menu} ${space.list} focus:outline-none ${space.anchor}`,
  comboOption: 'px-2.5 py-1.5 rounded-md text-sm text-stone-800 data-[focus]:bg-black/[0.05] data-[selected]:font-semibold cursor-pointer',
  comboOptionHint: 'block text-xs/4 font-normal text-stone-500',

  listboxBtn: 'appearance-none h-8 px-2.5 pr-8 w-full text-left rounded-md border border-black/[0.20] bg-field text-sm text-stone-900 focus:outline-none focus:ring-[3px] focus:ring-accent/30 focus:border-accent/70 cursor-pointer',
  listboxOptions: `z-[240] w-[var(--button-width)] max-h-56 overflow-auto ${material.menu} ${space.list} focus:outline-none ${space.anchor}`,
  labelMenuOptions: `z-[240] min-w-48 max-w-[min(20rem,calc(100vw-2rem))] w-max max-h-56 overflow-auto ${material.menu} ${space.list} focus:outline-none ${space.anchor}`,

  /** A checkbox row: the box and its label centred on one line, the field label's 6 below it, as a label's own. */
  booleanRow: 'flex items-center justify-between mb-1.5',
  booleanGroup: 'flex items-center gap-2',
  /** A checkbox's label: the field label's type, without its margin, which would lift it off the box's centre. */
  checkLabel: 'text-sm font-semibold cursor-pointer',
  checkbox: 'group block size-4 rounded border border-black/[0.45] bg-field data-[checked]:bg-accent data-[checked]:border-accent',
  checkboxIcon: 'stroke-cream-50 opacity-0 group-data-[checked]:opacity-100',

  arrayList: 'flex flex-col gap-1 mt-1',
  /** Boxes stacked as one group (an array's items, a checklist, the properties): one hairline between two of them, and
   *  only the group's outer corners round. */
  boxList: 'flex flex-col mt-1',
  /** A box in a `boxList`. Below the first, its top edge is the hairline of the box above, which the focused one draws
   *  in the accent over its neighbours. */
  listRow: `${box} relative rounded-none first:rounded-t-md last:rounded-b-md not-first:border-t-0 focus-within:z-10
            not-first:focus-within:shadow-[0_-1px_0_0_rgb(107_85_200/0.7)]`,

  dataFlowRow: 'flex items-center gap-1.5',
  /* Names wrap rather than truncate: an ellipsis would hide the name's suffix, which a reader scans for. */
  dataFlowFixed: 'flex-1 min-w-0 px-2 py-1 bg-transparent font-mono text-sm/6 text-stone-600 break-words',
  dataFlowBindInput: 'flex-1 min-w-0 px-2 py-1 bg-black/[0.03] font-mono text-sm/6 text-stone-900 placeholder-stone-400 focus:outline-none resize-none [field-sizing:content] break-words',
  dataFlowEquals: 'shrink-0 self-start py-1 px-0.5 font-mono text-sm/6 text-stone-500 select-none',
  dataFlowValue: 'flex-1 min-w-0 px-2.5 py-[3px] rounded-md border border-dashed border-black/[0.20] bg-cream-100 font-mono italic text-sm/6 text-stone-500 break-words',
  dataFlowScoped: 'flex flex-col',
  dataFlowScope: 'px-2 italic text-[0.6875rem] text-stone-500 truncate',

  /** A box alone, its corners round. */
  stateRow: `${box} rounded-md`,
  stateNameInput: 'flex-1 min-w-0 px-2 py-1.5 bg-transparent border-0 font-mono text-sm/5 text-stone-900 placeholder-stone-400 focus:outline-none',
  stateTypeField: 'relative shrink-0 flex items-stretch w-[8rem] border-l border-black/[0.10] bg-black/[0.03] focus-within:bg-black/[0.05]',
  /** A suggestion field alone in its row: the store a data store reference shows. */
  stateSuggestWide: 'relative flex-1 min-w-0 flex items-stretch',
  stateTypeInput: 'w-full min-w-0 pl-2 pr-6 py-1 bg-transparent border-0 font-mono text-sm/6 text-stone-600 placeholder-stone-400 placeholder:italic focus:outline-none',
  stateTypeChevronBtn: 'absolute top-0 right-0 h-full w-5 flex items-center justify-center text-stone-500 hover:text-stone-900 cursor-pointer',
  stateTypeChevron: `${ICONS.caretDown} shrink-0 text-[0.6875rem] text-stone-500`,
  stateTypeOptions: `z-[240] w-max min-w-[var(--input-width)] max-w-[15rem] max-h-56 overflow-auto ${material.menu} ${space.list} focus:outline-none ${space.anchor}`,
  stateTypeOption: 'px-2.5 py-1.5 rounded-md font-mono text-sm text-stone-800 truncate data-[focus]:bg-black/[0.05] data-[selected]:font-semibold cursor-pointer',
  stateTypeUntyped: 'font-sans italic text-stone-500',
  stateTypeNew: 'font-sans text-stone-500',
  /** A property the Parameters wired into the sub-process set: the value where a declared one's type sits, no remove. */
  stateLocked: 'flex items-center gap-1.5 h-8 rounded-md border border-dashed border-black/[0.30] bg-black/[0.04] px-2.5 font-mono text-sm text-stone-700 cursor-not-allowed',
  stateLockedValue: 'ml-auto truncate text-stone-500',
  stateRemoveBtn: 'shrink-0 w-7 flex items-center justify-center border-l border-black/[0.10] text-stone-500 hover:text-stone-900 hover:bg-black/[0.05] cursor-pointer',
} as const;

/** The inspector's editors of code and of a schema's columns: the button that opens one, and what its dialog (`Modal`)
 *  holds, on the shared fields, cards and buttons. */
export const codeEditor = {
  openButton: `${button.base} ${button.secondary} w-full mt-2`,
  body: 'flex flex-col flex-1 min-h-0',
  label: `${dialog.label} block mb-1.5`,
  selectWrapper: 'relative',
  select: `w-full ${textField.select}`,
  selectChevron: `${ICONS.caretDown} ${textField.chevron}`,
  editorFrame: `flex-1 min-h-[50vh] w-full overflow-auto ${radius.field} bg-field border border-black/[0.20]
                focus-within:ring-[3px] focus-within:ring-accent/30 focus-within:border-accent/70`,
  editor: 'min-h-full font-mono text-sm/6 text-stone-900',

  toolbar: 'flex items-center justify-between gap-3 mb-3',
  formats: 'flex items-center gap-4 text-sm text-stone-700',
  formatRadio: 'flex items-center gap-1.5 cursor-pointer',
  radio: 'size-3.5 accent-accent cursor-pointer',
  quietLink: 'text-xs text-stone-500 hover:text-stone-900 cursor-pointer',
  source: `${dialog.preview} font-mono text-xs text-stone-700 overflow-auto`,
  table: `overflow-x-auto ${radius.card} ${surface.card} border border-black/[0.10]`,
  head: `text-left ${sectionLabel} bg-black/[0.03]`,
  headCell: 'px-2.5 py-2 font-semibold',
  row: `border-t ${divider.edge}`,
  cell: 'px-2.5 py-1',
  cellInput: 'w-full h-7 bg-transparent font-mono text-xs text-stone-900 focus:outline-none',
  rowButton: `inline-flex items-center justify-center size-6 ${radius.button} text-stone-500 enabled:hover:text-stone-900
              enabled:hover:bg-black/[0.05] disabled:opacity-30 cursor-pointer`,
  removeButton: `inline-flex items-center justify-center size-6 ${radius.button} text-stone-500 hover:text-red-700
                 hover:bg-red-50 cursor-pointer`,
  empty: 'px-2.5 py-4 text-center text-sm text-stone-500 italic',
  tableFoot: `border-t ${divider.edge} p-1.5`,
  addButton: `${button.base} ${button.secondary}`,
} as const;

/**
 * The inline inspector (`InlineInspector.tsx`): the inspector's own fields as a compact property list, one 24px row
 * each, a muted label and its value beside it. The rows are one grid: the labels' column is as wide as the longest of
 * them (up to 6rem, then it cuts), and the fields themselves are `contents`, their label and input the grid's own
 * items. A field with no label of its own (a checkbox row) keeps to the values' column. A value is drawn quiet: a
 * faint fill with no frame, lifted to a field while it is edited, and a text grows with its lines. Each class is
 * written out, since Tailwind reads them as text.
 */
export const inline = {
  fields: `grid grid-cols-[fit-content(6rem)_minmax(0,1fr)] items-center gap-x-1.5 gap-y-0.5 p-1.5
           max-h-[45vh] overflow-y-auto
           [&>div]:contents [&>div>*]:col-start-2 [&>div>label]:col-start-1
           [&_label]:mb-0 [&_label]:min-w-0 [&_label]:pl-1 [&_label]:text-xs [&_label]:font-normal [&_label]:text-stone-500
           [&_label>span]:truncate
           [&_textarea]:min-h-6 [&_textarea]:px-1.5 [&_textarea]:py-0.5 [&_textarea]:rounded [&_textarea]:border-transparent
           [&_textarea]:bg-black/[0.04] [&_textarea]:font-sans [&_textarea]:text-[0.8125rem]/5 [&_textarea]:max-h-24
           [&_textarea]:[field-sizing:content] [&_textarea]:resize-none
           [&_textarea:hover]:bg-black/[0.07] [&_textarea:focus]:bg-field
           [&_[aria-haspopup=listbox]]:h-6 [&_[aria-haspopup=listbox]]:pl-1.5 [&_[aria-haspopup=listbox]]:pr-6
           [&_[aria-haspopup=listbox]]:rounded [&_[aria-haspopup=listbox]]:border-transparent
           [&_[aria-haspopup=listbox]]:bg-black/[0.04] [&_[aria-haspopup=listbox]]:text-[0.8125rem]
           [&_[aria-haspopup=listbox]]:truncate [&_[aria-haspopup=listbox]:hover]:bg-black/[0.07]
           [&_input]:h-6 [&_input]:px-1.5 [&_input]:rounded [&_input]:border-transparent [&_input]:bg-black/[0.04]
           [&_input]:font-sans [&_input]:text-[0.8125rem] [&_input:hover]:bg-black/[0.07] [&_input:focus]:bg-field`,
  more: `flex items-center justify-between gap-1 mx-1.5 mb-1 px-1 py-0.5 rounded text-xs text-stone-500
         hover:text-stone-900 hover:bg-black/[0.05] cursor-pointer transition-colors`,
} as const;
