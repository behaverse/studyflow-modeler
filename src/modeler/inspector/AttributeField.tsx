import { Field } from '@headlessui/react';
import { useEffect, useState } from 'react';
import { useModeler } from '../useModeler';
import { useInspectedElement } from './hooks/useInspectedElement';
import { pickInput } from './inputs';
import { getAttribute } from '@/lib/core/extensions';
import type { AttributeSpec } from '@/lib/core/catalog';
import { field as s } from '../styles';

/** Whether an attribute definition renders in the inspector. */
export function isAttributeVisible(attrDef: AttributeSpec | undefined, element: any): boolean {
  if (!attrDef || !element) return true;
  if (attrDef.meta?.pinned) return false;
  if (!attrDef.meta?.condition) return true;

  const conditions = attrDef.meta.condition.body || {};
  return Object.entries(conditions).every(([key, expected]) => {
    const actual = getAttribute(element, key);
    if (expected === '$set') return actual != null;
    if (Array.isArray(expected)) return expected.includes(actual);
    return actual === expected;
  });
}

export function AttributeField({ attrDef }: { attrDef: any }) {
  const element = useInspectedElement();
  const modeler = useModeler();
  const eventBus = modeler.get('eventBus');

  const [isVisible, setVisible] = useState(() => isAttributeVisible(attrDef, element));

  useEffect(() => {
    setVisible(isAttributeVisible(attrDef, element));

    const onElementChanged = (e: any) => {
      if (e.element) setVisible(isAttributeVisible(attrDef, e.element));
    };
    eventBus.on('element.changed', onElementChanged);
    return () => eventBus.off('element.changed', onElementChanged);
  }, [attrDef, element, eventBus]);

  if (!isVisible) return null;

  const Input = pickInput(attrDef);
  return (
    <Field className={s.field}>
      <Input attrDef={attrDef} />
    </Field>
  );
}
