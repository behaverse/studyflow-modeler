import { Checkbox, Label } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getProperty } from '@/lib/core/extensions';
import { executeCommand } from '../commands';
import { field as s } from '../styles';

type Props = {
  bpmnProperty: any;
};

export function BooleanInput({ bpmnProperty }: Props) {
  const { modeler } = useContext(ModelerContext);
  const { element } = useContext(InspectorContext);

  const name = bpmnProperty.ns?.name ?? bpmnProperty.name;
  const [value, setValue] = useState<boolean>(!!getProperty(element, name));

  function handleChange(checked: boolean) {
    setValue(checked);
    executeCommand(modeler, {
      type: 'update-property',
      element,
      propertyName: name,
      value: checked,
    });
  }

  return (
    <div className={s.booleanRow}>
      <span className={s.booleanGroup}>
        <Checkbox checked={value} onChange={handleChange} className={s.checkbox}>
          <svg className={s.checkboxIcon} viewBox="0 0 14 14" fill="none">
            <path d="M3 8L6 11L11 3.5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Checkbox>
        <Label className={s.label}>{t(bpmnProperty.ns.name)}</Label>
      </span>
      <div className={s.helpAnchor}>
        <i className={s.helpIcon}></i>
        <div className={s.helpTooltip}>
          <pre className={s.helpTooltipName}>{bpmnProperty.ns.name}</pre>
          {bpmnProperty?.description}
        </div>
      </div>
    </div>
  );
}
