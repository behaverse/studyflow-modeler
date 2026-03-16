import { useState } from 'react';
import { Select, Label, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { getProperty } from '../../shared/extensionElements';
import { useModelerStore } from '../store';
import { t } from '../../i18n';

interface EnumInputProps {
  bpmnProperty: any;
  businessObject: any;
  elementId: string;
}

export function EnumInput({ bpmnProperty, businessObject, elementId }: EnumInputProps) {
  const name = bpmnProperty.ns?.name ?? bpmnProperty.name;
  const [value, setValue] = useState(() => getProperty(businessObject, name) ?? '');
  const updateProperty = useModelerStore((s) => s.updateProperty);
  const doc = useModelerStore((s) => s.document);

  // Resolve enum literal values from the schema
  const propertyType = bpmnProperty.type?.split(':')?.[1];
  let literalValues: Array<{ name: string; value: string }> = [];

  if (propertyType && doc) {
    const pkg = bpmnProperty.definedBy?.$pkg;
    const enums = pkg?.enumerations ?? doc.getEnumerations();
    const enumDef = enums.find((e: any) => e.name === propertyType);
    literalValues = enumDef?.literalValues ?? [];
  }

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const newValue = event.target.value;
    setValue(newValue);
    updateProperty(elementId, name, newValue);
  }

  return (
    <>
      <Label className="flex items-center justify-between">
        {t(bpmnProperty.ns?.name ?? name)}
        <Popover className="relative group">
          <PopoverButton><i className="bi bi-patch-question text-stone-400" /></PopoverButton>
          <PopoverPanel anchor="top end" className="bg-stone-700 text-xs text-stone-300 p-2 rounded-lg shadow-lg z-50">
            <pre className="font-mono text-xs font-bold text-white">{bpmnProperty.ns?.name ?? name}</pre>
            {bpmnProperty?.description}
          </PopoverPanel>
        </Popover>
      </Label>
      <div className="relative">
        <Select
          name={name}
          aria-label={t(bpmnProperty.ns?.name ?? name)}
          onChange={handleChange}
          value={value}
          className="appearance-none px-2 py-1 pr-8 w-full rounded-md border-none bg-white/10 text-sm/6 text-stone-200 focus:outline-2 focus:-outline-offset-2 focus:outline-white/30"
        >
          {literalValues.map((l) => (
            <option key={l.value} value={l.value}>{l.name}</option>
          ))}
        </Select>
        <i className="group bi bi-caret-down pointer-events-none absolute top-1.5 right-2.5" aria-hidden="true" />
      </div>
    </>
  );
}
