import { Field } from '@headlessui/react';
import { useEffect, useState } from 'react';
import { useModeler } from '@/modeler/views/useModeler';
import { useInspectedElement } from '@/modeler/views/inspector/hooks/useInspectedElement';
import { pickInput } from '@/modeler/views/inspector/inputs';
import { isAttributeVisible } from '@/modeler/models/inspector/attributeVisibility';
import { elementKey } from '@/modeler/views/inspector/elementKey';
import { field as s } from '@/modeler/infra/styles';

/** A category's catalog fields, in schema order. Sections that lay out their
 *  own tab place this where the fields belong among their own parts. */
export function AttributeFields({ attrDefs }: { attrDefs: any[] }) {
  const element = useInspectedElement();
  return (
    <>
      {attrDefs.map((attrDef: any) => (
        <AttributeField key={`${elementKey(element)}:${attrDef.ns.prefix}:${attrDef.ns.name}`} attrDef={attrDef} />
      ))}
    </>
  );
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
