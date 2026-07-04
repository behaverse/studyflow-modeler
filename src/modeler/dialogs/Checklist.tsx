import { useMemo } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useModeler } from '../useModeler';
import { StudyflowElement } from '@/lib/core/extensions';
import { dialog as d } from '../styles';
import { DialogHelp } from './DialogHelp';
import { ICONS } from '@/icons';

type Item = {
  /** Raw label text after stripping the markdown bullet and checkbox marker. */
  text: string;
  /** True if the source line was `- [x] ...`, false for `- [ ] ...` or plain bullets. */
  checked: boolean;
  /** True only when the source line carried a `[ ]` / `[x]` marker (vs. a plain bullet). */
  isCheckbox: boolean;
};

type ElementGroup = {
  id: string;
  label: string;
  type: string;
  items: Item[];
};

const CHECKBOX_RE = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;

/** Parse a markdown checklist string into items, ignoring blank lines. */
function parseChecklist(markdown: string): Item[] {
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
function readChecklist(bo: any): string | undefined {
  if (typeof bo?.checklist === 'string' && bo.checklist.trim()) return bo.checklist;
  const ext = StudyflowElement.fromBusinessObject(bo).extension;
  const fromExt = ext?.get?.('checklist') ?? ext?.checklist;
  if (typeof fromExt === 'string' && fromExt.trim()) return fromExt;
  return undefined;
}

function collectGroups(modeler: any): ElementGroup[] {
  if (!modeler) return [];
  const elementRegistry = modeler.get('elementRegistry');
  const groups: ElementGroup[] = [];
  elementRegistry.forEach((el: any) => {
    if (el.type === 'label') return;
    const bo = el.businessObject;
    if (!bo) return;
    const checklist = readChecklist(bo);
    if (!checklist) return;
    const items = parseChecklist(checklist);
    if (items.length === 0) return;
    groups.push({
      id: el.id || bo.id || '(unnamed)',
      label: bo.name || bo.id || '(unnamed)',
      type: bo.$type || el.type || 'Element',
      items,
    });
  });
  return groups;
}

type Props = { isOpen: boolean; onClose: () => void };

export function ChecklistDialog({ isOpen, onClose }: Props) {
  const modeler = useModeler();
  const groups = useMemo(() => (isOpen ? collectGroups(modeler) : []), [isOpen, modeler]);

  const totalCheckboxes = groups.reduce(
    (sum, g) => sum + g.items.filter((i) => i.isCheckbox).length,
    0,
  );
  const totalChecked = groups.reduce(
    (sum, g) => sum + g.items.filter((i) => i.isCheckbox && i.checked).length,
    0,
  );

  return (
    <Dialog open={isOpen} onClose={onClose} className={d.root}>
      <div className={d.backdrop}>
        <div className={d.centerLayout}>
          <DialogPanel className={`${d.panelLg} ${d.panel}`}>
            <DialogTitle as="h3" className={`${d.title} pb-3 flex items-center gap-1`}>
              <span>Checklist View</span>
              <DialogHelp>
                Items aggregated from the <code>studyflow:checklist</code> attribute of every
                element in the current diagram. Markdown checkbox lines
                (<code>- [ ]</code> / <code>- [x]</code>) render as checkable items;
                plain bullets render as notes.
              </DialogHelp>
              <span className="flex-1" aria-hidden="true" />
              <span className={d.closeButton} onClick={onClose}>
                <i className={ICONS.close}></i>
              </span>
            </DialogTitle>
            {totalCheckboxes > 0 && (
              <p className="text-xs text-stone-500 pb-3">
                <strong>{totalChecked}</strong> of <strong>{totalCheckboxes}</strong> items complete.
              </p>
            )}
            {groups.length === 0 ? (
              <p className="text-sm text-stone-500 italic">
                No elements in this diagram carry a checklist attribute yet.
              </p>
            ) : (
              <ul className={`${d.panelBody} space-y-4`}>
                {groups.map((g) => (
                  <li key={g.id} className="border border-black/[0.06] rounded-lg p-3 bg-white/40">
                    <div className="flex items-baseline justify-between gap-3 pb-2">
                      <h4 className="text-sm font-semibold text-stone-900">{g.label}</h4>
                      <span className="text-[11px] font-mono text-stone-500">{g.type}</span>
                    </div>
                    <ul className="space-y-1">
                      {g.items.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-stone-800">
                          {item.isCheckbox ? (
                            <input
                              type="checkbox"
                              checked={item.checked}
                              readOnly
                              className="mt-1 accent-stone-700"
                              aria-label={item.text}
                            />
                          ) : (
                            <span className="mt-1 text-stone-400" aria-hidden="true">
                              •
                            </span>
                          )}
                          <span className={item.isCheckbox && item.checked ? 'line-through text-stone-500' : ''}>
                            {item.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
