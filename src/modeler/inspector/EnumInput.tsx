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
import { useContext, useMemo, useState } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getProperty } from '@/lib/core/extensions';
import { executeCommand } from '../commands';
import { toLocalName, toPrefix } from '@/lib/core/utils/naming';
import { field as s } from '../styles';

type Props = {
  bpmnProperty: any;
};

/**
 * Resolve the values for an enum-typed property, supporting types
 * defined in a different moddle package than the property itself */
function resolveEnumLiterals(bpmnProperty: any, modeler: any): any[] | null {
  const propertyType: string = bpmnProperty.type ?? '';
  const localName = toLocalName(propertyType);
  const targetPrefix = toPrefix(propertyType) ?? null;

  const definingPkg = bpmnProperty.definedBy?.$pkg;
  if (!targetPrefix || targetPrefix === definingPkg?.prefix) {
    return definingPkg?.enumerations?.find((e: any) => e.name === localName)?.literalValues ?? null;
  }

  const moddle = modeler?.get?.('moddle');
  if (!moddle) return null;

  const pkg =
    typeof moddle.getPackage === 'function'
      ? moddle.getPackage(targetPrefix)
      : (moddle.packages ? moddle.packages[targetPrefix] : undefined);

  return pkg?.enumerations?.find((e: any) => e.name === localName)?.literalValues ?? null;
}

export function EnumInput({ bpmnProperty }: Props) {
  const { element } = useContext(InspectorContext);
  const { modeler } = useContext(ModelerContext);

  const name = bpmnProperty.ns?.name ?? bpmnProperty.name;
  const literalValues = resolveEnumLiterals(bpmnProperty, modeler) ?? [];
  const isEditable = bpmnProperty.meta?.editable === true;
  const [value, setValue] = useState<string>(getProperty(element, name) || '');

  function commit(newValue: string) {
    setValue(newValue);
    executeCommand(modeler, {
      type: 'update-property',
      element,
      propertyName: name,
      value: newValue,
    });
  }

  return (
    <>
      <Label className={s.label}>
        {t(bpmnProperty.ns.name)}
        <div className={s.helpAnchor}>
          <i className={s.helpIcon}></i>
          <div className={s.helpTooltip}>
            <pre className={s.helpTooltipName}>{bpmnProperty.ns.name}</pre>
            {bpmnProperty?.description}
          </div>
        </div>
      </Label>
      {isEditable ? (
        <EditableEnumCombobox
          name={name}
          ariaLabel={t(bpmnProperty.ns.name)}
          value={value}
          literalValues={literalValues}
          onCommit={commit}
        />
      ) : (
        <PlainEnumSelect
          name={name}
          ariaLabel={t(bpmnProperty.ns.name)}
          value={value}
          literalValues={literalValues}
          onCommit={commit}
        />
      )}
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
