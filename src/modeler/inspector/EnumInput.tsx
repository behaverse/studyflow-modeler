import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/react';
import { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { getActiveCatalog } from '@/lib/core/catalog';
import { HelpTooltip } from './HelpTooltip';
import { useAttributeState } from './hooks/useAttributeState';
import { field as s } from '../styles';

type Props = {
  attrDef: any;
};

export function EnumInput({ attrDef }: Props) {
  const { value, commit } = useAttributeState<string>(attrDef, (raw) => raw || '');
  const name = attrDef.ns.name;
  const literalValues = getActiveCatalog().enumOf(attrDef.type)?.literals ?? [];
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

type SubProps = {
  name: string;
  ariaLabel: string;
  value: string;
  literalValues: Array<{ name: string; value: string }>;
  onCommit: (next: string) => void;
};

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
              {l.name}
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
      l.name.toLowerCase().includes(q) || l.value.toLowerCase().includes(q),
    );
  }, [literalValues, query]);

  function displayValue(v: string | null) {
    if (v == null) return '';
    return labelByValue.get(v) ?? v;
  }

  function commitIfChanged(next: string) {
    if (next !== value) onCommit(next);
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
          onBlur={(event) => commitIfChanged(event.target.value)}
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
              {l.name}
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      </Combobox>
    </div>
  );
}
