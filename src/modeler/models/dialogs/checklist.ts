import { StudyflowElement } from '@/core/extensions';

export type Item = {
  /** Raw label text after stripping the markdown bullet and checkbox marker. */
  text: string;
  /** True if the source line was `- [x] ...`, false for `- [ ] ...` or plain bullets. */
  checked: boolean;
  /** True only when the source line carried a `[ ]` / `[x]` marker (vs. a plain bullet). */
  isCheckbox: boolean;
};

export type ElementGroup = {
  id: string;
  label: string;
  type: string;
  items: Item[];
};

const CHECKBOX_RE = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;

/** Parse a markdown checklist string into items, ignoring blank lines. */
export function parseChecklist(markdown: string): Item[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const cb = line.match(CHECKBOX_RE);
      if (cb) return { text: cb[2].trim(), checked: cb[1].toLowerCase() === 'x', isCheckbox: true };
      const bullet = line.match(BULLET_RE);
      if (bullet) return { text: bullet[1].trim(), checked: false, isCheckbox: false };
      const trimmed = line.trim();
      return trimmed ? { text: trimmed, checked: false, isCheckbox: false } : null;
    })
    .filter((item): item is Item => item !== null);
}

/** Read the checklist attribute from a BO or its extension element (whichever has it). */
export function readChecklist(bo: any): string | undefined {
  if (typeof bo?.checklist === 'string' && bo.checklist.trim()) return bo.checklist;
  const ext = StudyflowElement.fromBusinessObject(bo).extension;
  const fromExt = ext?.get?.('checklist') ?? ext?.checklist;
  if (typeof fromExt === 'string' && fromExt.trim()) return fromExt;
  return undefined;
}

/** Build a checklist group from a diagram element, or `null` when it carries
 *  no (non-empty) checklist attribute. */
export function buildChecklistGroup(el: any): ElementGroup | null {
  const bo = el.businessObject;
  if (!bo) return null;
  const checklist = readChecklist(bo);
  if (!checklist) return null;
  const items = parseChecklist(checklist);
  if (items.length === 0) return null;
  return {
    id: el.id || bo.id || '(unnamed)',
    label: bo.name || bo.id || '(unnamed)',
    type: bo.$type || el.type || 'Element',
    items,
  };
}
