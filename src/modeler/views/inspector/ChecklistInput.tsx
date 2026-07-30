import { Input, Label } from '@headlessui/react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { t } from '@/i18n';
import { ICONS } from '@/icons';
import { HelpTooltip } from '@/modeler/views/inspector/HelpTooltip';
import { useAttributeState } from '@/modeler/views/inspector/hooks/useAttributeState';
import { field as s } from '@/modeler/infra/styles';

/**
 * The checklist as a checklist: checkable boxes and per-item text, stored as
 * the same markdown task lines (`- [ ]` / `- [x]`) as ever — the editor is a
 * view over the text, not a second format. A line that is not a task item
 * (a note, a heading) keeps its row, editable but uncheckable, so nothing an
 * author wrote is hidden or dropped by the nicer surface.
 */

type Line =
  | { kind: 'task'; indent: string; checked: boolean; text: string }
  | { kind: 'plain'; text: string };

const TASK = /^(\s*)- \[( |x|X)\] (.*)$/;

function parse(markdown: string): Line[] {
  if (!markdown.trim()) return [];
  return markdown.split('\n').map((line): Line => {
    const task = TASK.exec(line);
    if (task) return { kind: 'task', indent: task[1], checked: task[2] !== ' ', text: task[3] };
    return { kind: 'plain', text: line };
  });
}

function serialize(lines: Line[]): string {
  return lines
    .map((line) => (line.kind === 'task' ? `${line.indent}- [${line.checked ? 'x' : ' '}] ${line.text}` : line.text))
    .join('\n');
}

export function ChecklistInput({ attrDef }: { attrDef: any }) {
  const { value, commit } = useAttributeState<string>(attrDef, (raw) => raw || '');
  const name = attrDef.ns.name;
  const lines = parse(value);

  const update = (next: Line[]) => commit(serialize(next));
  const patch = (index: number, line: Line) => update(lines.map((l, i) => (i === index ? line : l)));

  const addItem = (after?: number) => {
    const item: Line = { kind: 'task', indent: '', checked: false, text: '' };
    const at = after === undefined ? lines.length : after + 1;
    update([...lines.slice(0, at), item, ...lines.slice(at)]);
  };

  const onKeyDown = (index: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter starts the next item, as it would in any checklist app; the
    // storage stays one markdown line per row.
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem(index);
    }
  };

  return (
    <div className={s.field}>
      <Label className={s.label}>
        {t(name)}
        <span className={s.labelActions}>
          <button
            type="button"
            aria-label="Add checklist item"
            onClick={() => addItem()}
            className={s.labelAddBtn}
          >
            <i className={`${ICONS.plus} text-base`} />
          </button>
          <HelpTooltip name={name} description={attrDef?.description} />
        </span>
      </Label>
      {lines.length > 0 && (
        <div className={s.arrayList}>
          {lines.map((line, index) => (
            <div key={index} className={s.stateRow}>
              {line.kind === 'task' ? (
                <input
                  type="checkbox"
                  checked={line.checked}
                  onChange={() => patch(index, { ...line, checked: !line.checked })}
                  aria-label={`${line.checked ? 'Uncheck' : 'Check'} ${line.text || 'item'}`}
                  className="ml-2 my-auto shrink-0 accent-stone-700"
                />
              ) : (
                <span className="ml-2 my-auto shrink-0 text-stone-400" aria-hidden="true">•</span>
              )}
              <Input
                type="text"
                aria-label={`Checklist item ${index + 1}`}
                value={line.text}
                placeholder={line.kind === 'task' ? 'item…' : ''}
                onChange={(e: ChangeEvent<HTMLInputElement>) => patch(index, { ...line, text: e.target.value })}
                onKeyDown={onKeyDown(index)}
                className={`${s.stateNameInput} ${line.kind === 'task' && line.checked ? 'line-through text-stone-500' : ''}`}
              />
              <button
                type="button"
                aria-label={`Remove checklist item ${index + 1}`}
                onClick={() => update(lines.filter((_, i) => i !== index))}
                className={s.stateRemoveBtn}
              >
                <i className={`${ICONS.closeSmall} text-sm`} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
