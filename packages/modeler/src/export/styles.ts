import { ICONS } from '@modeler/icons';
import { choice, dialog as d, divider, text, textField } from '@modeler/ui/styles';

/** The Save dialog's look, which a skill's destination panel wears too. */
export const saveDialog = {
  row: 'flex items-center gap-3',
  rowLabel: `text-sm font-medium ${text.secondary} shrink-0 w-16`,
  selectWrapper: 'relative flex-1 min-w-0',
  select: `w-full ${textField.select}`,
  selectChevron: `${ICONS.caretDown} ${textField.chevron}`,
  /** A number among words: the TIFF's width on paper, and its dots per inch. */
  numberField: `w-20 text-right ${textField.input}`,
  inline: 'flex-1 flex flex-wrap items-center gap-2 text-sm text-stone-700',

  segmented: `flex-1 ${choice.track}`,
  segment: `flex-1 ${choice.base}`,
  segmentIdle: choice.idle,
  segmentActive: choice.selected,

  fields: `mt-4 pt-4 border-t ${divider.edge} space-y-4`,
  footer: `${d.footer} justify-between`,
  filename: 'font-mono text-xs text-stone-500 truncate',
  primaryBtn: d.primaryBtn,
  error: `${d.error} mt-2`,
  status: 'text-xs text-stone-600 mt-2',
} as const;
