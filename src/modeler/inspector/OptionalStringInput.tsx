import { Checkbox, Input, Label } from '@headlessui/react';
import { useContext, useState, type ChangeEvent } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getProperty } from '../extensions';
import { executeCommand } from '../commands';
import { field as s } from '../styles';

type Props = {
  bpmnProperty: any;
};

export function OptionalStringInput({ bpmnProperty }: Props) {
  const { modeler } = useContext(ModelerContext);
  const { element } = useContext(InspectorContext);

  const name = bpmnProperty.ns?.name ?? bpmnProperty.name;
  const initial = getProperty(element, name);
  const [value, setValue] = useState<string | undefined>(
    initial == null ? undefined : String(initial),
  );

  const isSet = value !== undefined;

  function commit(next: string | undefined) {
    setValue(next);
    executeCommand(modeler, {
      type: 'update-property',
      element,
      propertyName: name,
      value: next,
    });
  }

  function handleToggle(checked: boolean) {
    commit(checked ? '' : undefined);
  }

  function handleTextChange(event: ChangeEvent<HTMLInputElement>) {
    commit(event.target.value);
  }

  return (
    <>
      <div className={s.booleanRow}>
        <span className={s.booleanGroup}>
          <Checkbox checked={isSet} onChange={handleToggle} className={s.checkbox}>
            <svg className={s.checkboxIcon} viewBox="0 0 14 14" fill="none">
              <path d="M3 8L6 11L11 3.5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Checkbox>
          <Label className={s.label}>{t(bpmnProperty.ns.name)}</Label>
        </span>
        <div className={s.helpAnchor}>
          <i className={s.helpIcon}></i>
          <div className={s.helpTooltipWide}>
            <pre className={s.helpTooltipName}>{bpmnProperty.ns.name}</pre>
            {bpmnProperty?.description}
          </div>
        </div>
      </div>
      {isSet && (
        <Input
          name={bpmnProperty.ns.name}
          type="text"
          onChange={handleTextChange}
          value={value ?? ''}
          className={s.textInput}
        />
      )}
    </>
  );
}
