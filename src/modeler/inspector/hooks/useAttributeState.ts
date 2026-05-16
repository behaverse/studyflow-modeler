import { useState } from 'react';
import { useModeler } from '../../useModeler';
import { useInspectedElement } from './useInspectedElement';
import { getAttribute } from '@/lib/core/extensions';
import { executeCommand } from '../../commands';

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
