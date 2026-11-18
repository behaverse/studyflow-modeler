import { useMemo, useState, type FormEvent } from 'react';
import { withTask, withTaskChecked } from '@core/document';
import { useModeler } from '@modeler/app/useModeler';
import { collectChecklistGroups } from '@modeler/checklist/groups';
import { executeCommand } from '@modeler/commandBus';
import { useSelection } from '@modeler/composer/hooks';
import { dialog as d, textField } from '@modeler/ui/styles';
import { showElement, useStudyVersion } from '@modeler/views/hooks';
import { drawer as v } from '@modeler/views/styles';

/**
 * The checklists, a view in the drawer under the canvas: every element's, and how much of it is done. A tick checks an
 * item off in the study, and a new item goes on the selected element's list (the study's while nothing is selected).
 * The lists are one column, read top to bottom. The selection's list is marked, and a press on a list's name selects
 * its element.
 */
export function ChecklistView() {
  const modeler = useModeler();
  const version = useStudyVersion(modeler);
  const selection = useSelection(modeler);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands in for the study
  const groups = useMemo(() => collectChecklistGroups(modeler), [modeler, version]);
  const [draft, setDraft] = useState('');

  const { model } = modeler.study;
  const selected = selection.length === 1 ? modeler.study.get(selection[0]) : undefined;
  const target = (selected?.kind === 'label' ? selected.owner : selected?.id) ?? modeler.study.root.id;
  const targetName = model.get(target)?.name || target;
  const textOf = (id: string): string => {
    const element = model.get(id);
    const text = element && model.attribute(element, 'checklist');
    return typeof text === 'string' ? text : '';
  };
  const write = (id: string, value: string) =>
    executeCommand(modeler, { type: 'UpdateAttribute', element: { id }, attributeName: 'studyflow:checklist', value });

  const boxes = groups.flatMap((group) => group.items.filter((item) => item.isCheckbox));
  const done = boxes.filter((item) => item.checked).length;
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    void write(target, withTask(textOf(target), draft));
    setDraft('');
  };

  return (
    <>
      <div className={v.bar}>
        {boxes.length > 0 ? <span><strong>{done}</strong> of {boxes.length} done</span> : <span>No checklists yet.</span>}
        <form className="ml-auto" onSubmit={add}>
          <input
            className={`${textField.input} h-7 w-64 max-w-full text-xs`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Add an item to ${targetName}`}
            aria-label="New checklist item"
          />
        </form>
      </div>
      {groups.length > 0 && (
        <ul className="flex flex-col gap-2">
          {groups.map((group) => {
            let box = -1;
            return (
              <li key={group.id} className={`${d.card} ${selection.includes(group.id) ? v.selected : ''}`}>
                <button type="button" className="flex items-baseline justify-between gap-3 w-full pb-2 text-left cursor-pointer" onClick={() => showElement(modeler, group.id)}>
                  <span className="text-sm font-semibold text-stone-900">{group.label}</span>
                  <span className="text-[0.6875rem] font-mono text-stone-500">{group.type}</span>
                </button>
                <ul className="space-y-1.5">
                  {group.items.map((item, index) => {
                    const at = item.isCheckbox ? ++box : -1;
                    return (
                      <li key={index} className="flex items-start gap-2 text-sm text-stone-800">
                        {item.isCheckbox ? (
                          <input
                            type="checkbox"
                            checked={item.checked}
                            onChange={(event) => { void write(group.id, withTaskChecked(textOf(group.id), at, event.target.checked)); }}
                            className={`mt-[3px] ${d.checkbox}`}
                            aria-label={item.text}
                          />
                        ) : (
                          <span className="mt-px text-stone-500" aria-hidden="true">•</span>
                        )}
                        <span className={item.isCheckbox && item.checked ? 'line-through text-stone-500' : ''}>{item.text}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
