import { Select, Label } from '@headlessui/react';
import { useContext, useState, type ChangeEvent } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getProperty } from '../extensions';
import { executeCommand } from '../commands';
import { toLocalName } from '../utils/naming';

type Props = {
  bpmnProperty: any;
};

export function EnumInput({ bpmnProperty }: Props) {
  const { element } = useContext(InspectorContext);
  const { modeler } = useContext(ModelerContext);

  const name = bpmnProperty.ns?.name ?? bpmnProperty.name;
  const propertyType = toLocalName(bpmnProperty.type);
  const pkg = bpmnProperty.definedBy.$pkg;
  const literalValues = pkg['enumerations'].find((e: any) => e.name === propertyType).literalValues;
  const [value, setValue] = useState<string>(getProperty(element, name) || '');

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
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
      <Label className="flex items-center justify-between">
        {t(bpmnProperty.ns.name)}
        <div className="relative group/help">
          <i className="iconify bi--patch-question text-stone-500 cursor-help"></i>
          <div className="absolute bottom-full right-0 mb-1 invisible group-hover/help:visible w-64 bg-stone-700 text-xs text-stone-300 p-2 rounded-lg shadow-xl z-50">
            <pre className="font-mono text-xs font-bold text-white">{bpmnProperty.ns.name}</pre>
            {bpmnProperty?.description}
          </div>
        </div>
      </Label>
      <div className="relative">
        <Select
          name={bpmnProperty.ns.name}
          aria-label={t(bpmnProperty.ns.name)}
          onChange={handleChange}
          value={value}
          className="appearance-none px-2 py-1 pr-8 w-full rounded-md border border-[#b0a993]/40 bg-[#f1ede0] text-sm/6 text-stone-800 focus:outline-2 focus:-outline-offset-2 focus:outline-[#b0a993]"
        >
          {literalValues.map((l: any) => (
            <option key={l.value} value={l.value}>{l.name}</option>
          ))}
        </Select>
        <i className="group iconify bi--caret-down pointer-events-none absolute top-1.5 right-2.5" aria-hidden="true"></i>
      </div>
    </>
  );
}
