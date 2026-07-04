import { useMemo } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useModeler } from '@/modeler/views/useModeler';
import { buildChecklistGroup, type ElementGroup } from '@/modeler/models/dialogs/checklist';
import { dialog as d } from '@/modeler/infra/styles';
import { DialogHelp } from '@/modeler/views/dialogs/DialogHelp';
import { ICONS } from '@/icons';

function collectGroups(modeler: any): ElementGroup[] {
  if (!modeler) return [];
  const elementRegistry = modeler.get('elementRegistry');
  const groups: ElementGroup[] = [];
  elementRegistry.forEach((el: any) => {
    if (el.type === 'label') return;
    const group = buildChecklistGroup(el);
    if (group) groups.push(group);
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
