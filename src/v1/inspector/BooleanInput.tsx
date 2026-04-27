import { Checkbox, Label } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getProperty } from '../extensions';
import { executeCommand } from '../commands';

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
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2">
        <Checkbox
          checked={value}
          onChange={handleChange}
          className="group block size-4 rounded border border-[#b0a993]/60 bg-[#f1ede0] data-[checked]:bg-violet-800 data-[checked]:border-violet-800"
        >
          {/* Checkmark icon */}
          <svg className="stroke-white opacity-0 group-data-[checked]:opacity-100" viewBox="0 0 14 14" fill="none">
            <path d="M3 8L6 11L11 3.5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Checkbox>
        <Label className="flex items-center justify-between">
          {t(bpmnProperty.ns.name)}
        </Label>
      </span>
      <div className="relative group/help">
        <i className="iconify bi--patch-question text-stone-500 cursor-help"></i>
        <div className="absolute bottom-full right-0 mb-1 invisible group-hover/help:visible w-64 bg-stone-700 text-xs text-stone-300 p-2 rounded-lg shadow-xl z-50">
          <pre className="font-mono text-xs font-bold text-white">{bpmnProperty.ns.name}</pre>
          {bpmnProperty?.description}
        </div>
      </div>
    </div>
  );
}
