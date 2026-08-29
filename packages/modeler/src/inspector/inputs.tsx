import type { AttributeSpec, EnumLiteral } from '@core/notation';
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Field,
  Input,
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Textarea,
} from '@headlessui/react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { t } from '@modeler/i18n';
import { ICONS } from '@modeler/icons';
import { getCatalog } from '@core/notation';
import { getAttribute, getExpressionLanguage } from '@core/element';
import { parseChecklistLines, serializeChecklistLines, type ChecklistLine } from '@core/document';
import { executeCommand } from '@modeler/commandBus';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { useAttributeState, useInspectedElement } from '@modeler/inspector/state';
import { HelpTooltip } from '@modeler/inspector/widgets';
import { field as s } from '@modeler/inspector/styles';

type Props = { attrDef: AttributeSpec };

export function ExpressionRow({ name, placeholder, value, language, onCommit, onCommitLanguage }: {
  name: string;
  placeholder?: string;
  value: string;
  language: string;
  onCommit: (next: string) => void;
  onCommitLanguage: (next: string | undefined) => void;
}) {
  return (
    <div className="flex items-stretch gap-1">
      <select
        aria-label="Expression language"
        value={language}
        disabled={!value}
        title={value
          ? 'Expression language leaves it to the runner that executes it'
          : 'Type an expression first'}
        onChange={(e) => onCommitLanguage(e.target.value || undefined)}
        className="shrink-0 w-11 rounded-md border border-black/[0.08] bg-cream-200
          text-[11px] text-stone-500 px-1 cursor-pointer focus:outline-2
          focus:-outline-offset-2 focus:outline-[hsl(205,100%,45%)] disabled:opacity-40
          disabled:cursor-default"
      >
        <option value="">-</option>
        <option value="python">PY</option>
        <option value="javascript">JS</option>
      </select>
      <Textarea
        name={name}
        rows={1}
        placeholder={placeholder}
        value={value}
        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onCommit(e.target.value.replace(/\s*\n\s*/g, ' '))}
        className={`${s.textInput} flex-1`}
      />
    </div>
  );
}

export function ExpressionInput({ attrDef }: { attrDef: AttributeSpec }) {
  const element = useInspectedElement();
  const modeler = useRequiredModeler();
  const attributeName = attrDef.ns?.name ?? attrDef.name;

  const raw = getAttribute(element, attributeName);
  const value = typeof raw === 'string' ? raw : '';
  const language = getExpressionLanguage(element, attributeName) ?? '';

  return (
    <Field className={s.field}>
      <Label className={s.label}>
        {t(attributeName)}
        <HelpTooltip name={attributeName} description={attrDef?.description} />
      </Label>
      <ExpressionRow
        name={attributeName}
        value={value}
        language={language}
        onCommit={(next) => {
          executeCommand(modeler, { type: 'UpdateAttribute', element, attributeName, value: next });
        }}
        onCommitLanguage={(next) => {
          executeCommand(modeler, {
            type: 'UpdateExpressionLanguage', element, attributeName, language: next,
          });
        }}
      />
    </Field>
  );
}

function toArray(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map((item) => (item == null ? '' : String(item)));
  if (raw == null || raw === '') return [];
  return [String(raw)];
}

export function ArrayInput({ attrDef }: Props) {
  const fullName = attrDef.ns?.name ?? attrDef.name;

  const { value: values, commit: persist, flush } = useAttributeState<string[]>(attrDef, toArray, { debounceMs: 400 });
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const focusIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (focusIndexRef.current != null) {
      inputRefs.current[focusIndexRef.current]?.focus();
      focusIndexRef.current = null;
    }
  }, [values]);

  function handleChangeAt(index: number, event: ChangeEvent<HTMLInputElement>) {
    const next = values.slice();
    next[index] = event.target.value;
    persist(next);
  }

  function handleRemoveAt(index: number) {
    const next = values.slice();
    next.splice(index, 1);
    persist(next);
  }

  function handleAdd() {
    focusIndexRef.current = values.length;
    persist([...values, '']);
  }

  return (
    <>
      <Label className={s.label}>
        {t(fullName)}
        <span className={s.labelActions}>
          <button
            type="button"
            aria-label="Add another item"
            title="Add another item"
            onClick={handleAdd}
            className={s.labelAddBtn}
          >
            <i className={`${ICONS.plus} text-base`} />
          </button>
          <HelpTooltip name={fullName} description={attrDef?.description} />
        </span>
      </Label>

      <div className={s.arrayList}>
        {values.map((value, i) => (
          <div key={i} className={s.arrayRow}>
            <Input
              ref={(el: HTMLInputElement | null) => { inputRefs.current[i] = el; }}
              name={`${fullName}[${i}]`}
              type="text"
              value={value}
              onChange={(e) => handleChangeAt(i, e)}
              onBlur={flush}
              className={s.arrayInput}
            />
            <button
              type="button"
              aria-label="Remove"
              onClick={() => handleRemoveAt(i)}
              className={s.arrayRemoveBtn}
            >
              <i className={`${ICONS.closeSmall} text-lg`} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

type Line = ChecklistLine;

export function ChecklistInput({ attrDef }: { attrDef: AttributeSpec }) {
  const { value, commit, flush } = useAttributeState<string>(attrDef, (raw) => raw || '', { debounceMs: 400 });
  const name = attrDef.ns.name;
  const lines = parseChecklistLines(value);

  const update = (next: Line[]) => commit(serializeChecklistLines(next));
  const patch = (index: number, line: Line) => update(lines.map((l, i) => (i === index ? line : l)));

  const addItem = (after?: number) => {
    const item: Line = { kind: 'task', indent: '', bullet: '-', checked: false, text: '' };
    const at = after === undefined ? lines.length : after + 1;
    update([...lines.slice(0, at), item, ...lines.slice(at)]);
  };

  const onKeyDown = (index: number) => (e: KeyboardEvent<HTMLInputElement>) => {
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
                <span className="ml-2 my-auto shrink-0 text-stone-500" aria-hidden="true">•</span>
              )}
              <Input
                type="text"
                aria-label={`Checklist item ${index + 1}`}
                value={line.text}
                placeholder={line.kind === 'task' ? 'item…' : ''}
                onChange={(e: ChangeEvent<HTMLInputElement>) => patch(index, { ...line, text: e.target.value })}
                onBlur={flush}
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

export function EnumInput({ attrDef }: Props) {
  const { value, commit } = useAttributeState<string>(attrDef, (raw) => raw || '');
  const name = attrDef.ns.name;
  const literalValues = toOptions(getCatalog().enumOf(attrDef.type)?.literals);
  const isEditable = attrDef.meta?.editable === true;
  const Picker = isEditable ? EditableEnumCombobox : PlainEnumSelect;

  return (
    <>
      <Label className={s.label}>
        {t(name)}
        <HelpTooltip name={name} description={attrDef?.description} wide={false} />
      </Label>
      <Picker
        name={name}
        ariaLabel={t(name)}
        value={value}
        literalValues={literalValues}
        onCommit={commit}
      />
    </>
  );
}

type Option ={ name: string; value: string; description?: string };

function toOptions(literals: EnumLiteral[] | undefined): Option[] {
  return (literals ?? []).map((literal) => ({
    name: literal.name,
    value: String(literal.value),
    description: literal.description,
  }));
}

type SubProps = {
  name: string;
  ariaLabel: string;
  value: string;
  literalValues: Option[];
  onCommit: (next: string) => void;
};

function OptionLabel({ option }: { option: Option }) {
  if (!option.description) return <>{option.name}</>;
  return (
    <>
      {option.name}
      <span className={s.comboOptionHint}>{option.description}</span>
    </>
  );
}

function PlainEnumSelect({ name, ariaLabel, value, literalValues, onCommit }: SubProps) {
  const currentLabel = literalValues.find((l) => l.value === value)?.name ?? value;
  return (
    <div className={s.selectWrapper}>
      <Listbox value={value} onChange={onCommit}>
        <ListboxButton name={name} aria-label={ariaLabel} className={s.listboxBtn}>
          {currentLabel}
        </ListboxButton>
        <span className={s.comboChevronIndicator} aria-hidden="true">
          <i className={s.comboChevronIcon}></i>
        </span>
        <ListboxOptions anchor="bottom start" className={s.listboxOptions}>
          {literalValues.map((l) => (
            <ListboxOption key={l.value} value={l.value} className={s.comboOption}>
              <OptionLabel option={l} />
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
    </div>
  );
}

function EditableEnumCombobox({ name, ariaLabel, value, literalValues, onCommit }: SubProps) {
  const [query, setQuery] = useState('');

  const labelByValue = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of literalValues) m.set(l.value, l.name);
    return m;
  }, [literalValues]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return literalValues;
    return literalValues.filter((l) =>
      l.name.toLowerCase().includes(q)
      || l.value.toLowerCase().includes(q)
      || l.description?.toLowerCase().includes(q),
    );
  }, [literalValues, query]);

  function displayValue(v: string | null) {
    if (v == null) return '';
    return labelByValue.get(v) ?? v;
  }

  function commitIfChanged(next: string) {
    if (next !== value) onCommit(next);
  }

  /** The field shows a literal's *label*, so text maps to its value ("N-Back (NB)" -> "NB") */
  function resolveTyped(text: string): string {
    const typed = text.trim();
    if (!typed) return '';
    const match = literalValues.find((l) =>
      l.name.toLowerCase() === typed.toLowerCase() || l.value.toLowerCase() === typed.toLowerCase());
    return match ? match.value : typed;
  }

  return (
    <div className={s.selectWrapper}>
      <Combobox
        value={value}
        onChange={(next) => {
          if (next != null) {
            setQuery('');
            commitIfChanged(next);
          }
        }}
        onClose={() => setQuery('')}
      >
        <ComboboxInput
          name={name}
          aria-label={ariaLabel}
          className={s.comboInput}
          displayValue={displayValue}
          onChange={(event) => setQuery(event.target.value)}
          onBlur={(event) => {
            setQuery('');
            commitIfChanged(resolveTyped(event.target.value));
          }}
        />
        <ComboboxButton className={s.comboChevronBtn} aria-label="Show suggestions">
          <i className={s.comboChevronIcon} aria-hidden="true"></i>
        </ComboboxButton>
        <ComboboxOptions
          anchor="bottom start"
          className={s.comboOptions}
        >
          {filtered.map((l) => (
            <ComboboxOption key={l.value} value={l.value} className={s.comboOption}>
              <OptionLabel option={l} />
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      </Combobox>
    </div>
  );
}
