import { useState } from 'react';
import { Input, Label, Textarea, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { getProperty } from '../../shared/extensionElements';
import { useModelerStore } from '../store';
import { t } from '../../i18n';

interface StringInputProps {
  bpmnProperty: any;
  businessObject: any;
  elementId: string;
  isMarkdown?: boolean;
}

export function StringInput({ bpmnProperty, businessObject, elementId, isMarkdown }: StringInputProps) {
  const name = bpmnProperty.ns?.name ?? bpmnProperty.name;
  const [value, setValue] = useState(() => getProperty(businessObject, name) ?? '');
  const updateProperty = useModelerStore((s) => s.updateProperty);

  function handleChange(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
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
          <PopoverPanel anchor="top end" className="max-w-md w-64 bg-stone-700 text-xs text-stone-300 p-2 rounded-lg shadow-xl z-50">
            <pre className="font-mono text-xs font-bold text-white">{bpmnProperty.ns?.name ?? name}</pre>
            {bpmnProperty?.description}
          </PopoverPanel>
        </Popover>
      </Label>
      {isMarkdown ? (
        <Textarea
          name={name}
          onChange={handleChange}
          value={value}
          rows={4}
          className="px-2 py-1 w-full rounded-md border-none bg-white/10 font-mono text-sm/4 text-stone-200 placeholder-stone-500 focus:outline-2 focus:-outline-offset-2 focus:outline-white/30"
        />
      ) : (
        <Input
          name={name}
          type="text"
          onChange={handleChange}
          value={value}
          className="px-2 py-1 w-full rounded-md border-none bg-white/10 font-mono text-sm/6 text-stone-200 placeholder-stone-500 focus:outline-2 focus:-outline-offset-2 focus:outline-white/30"
        />
      )}
    </>
  );
}
