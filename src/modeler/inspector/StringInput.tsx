import { Input, Label, Textarea } from '@headlessui/react';
import { useContext, useState, type ChangeEvent } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getProperty } from '@/lib/core/extensions';
import { executeCommand } from '../commands';
import { field as s } from '../styles';

type Props = {
  bpmnProperty: any;
  isMarkdown?: boolean;
};

export function StringInput({ bpmnProperty, isMarkdown }: Props) {
  const { element } = useContext(InspectorContext);
  const { modeler } = useContext(ModelerContext);

  const name = bpmnProperty.ns?.name ?? bpmnProperty.name;
  const [value, setValue] = useState<string>(getProperty(element, name) || '');

  function handleChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const newValue = event.target.value;
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
          <div className={s.helpTooltipWide}>
            <pre className={s.helpTooltipName}>{bpmnProperty.ns.name}</pre>
            {bpmnProperty?.description}
          </div>
        </div>
      </Label>
      {isMarkdown ? (
        <Textarea
          name={bpmnProperty.ns.name}
          onChange={handleChange}
          value={value}
          rows={4}
          className={s.textArea}
        />
      ) : (
        <Input
          name={bpmnProperty.ns.name}
          type="text"
          onChange={handleChange}
          value={value}
          className={s.textInput}
        />
      )}
    </>
  );
}
