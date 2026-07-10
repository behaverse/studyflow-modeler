import { useState } from 'react';
import { useModeler } from '@/modeler/views/useModeler';
import { useInspectedElement } from '@/modeler/views/inspector/hooks/useInspectedElement';
import { getAttribute } from '@/core/extensions';
import { executeCommand } from '@/modeler/controllers/commandBus';

/** Shared state + commit wiring for inspector inputs; `parse` normalizes the raw moddle value. */
export function useAttributeState<T>(
  attrDef: any,
  parse: (raw: any) => T,
) {
  const element = useInspectedElement();
  const modeler = useModeler();
  const attributeName = attrDef.ns?.name ?? attrDef.name;

  const [value, setValue] = useState<T>(parse(getAttribute(element, attributeName)));

  const commit = (next: T) => {
    setValue(next);
    executeCommand(modeler, { type: 'update-attribute', element, attributeName, value: next });
  };

  return { value, commit, attributeName, element, modeler };
}
