import { useState } from 'react';
import { Field } from '@headlessui/react';
import { getProperty } from '../../shared/extensionElements';
import { useModelerStore } from '../store';
import { isPropertyVisible } from './Panel';
import { StringInput } from './StringInput';
import { BooleanInput } from './BooleanInput';
import { EnumInput } from './EnumInput';

interface PropertyFieldProps {
  bpmnProperty: any;
  businessObject: any;
  elementId: string;
}

function resolveGenericType(bpmnProperty: any, moddle: any): string {
  const propertyType = bpmnProperty.type || 'String';
  const [pkg, name] = propertyType.split(':');

  if (pkg && name && moddle) {
    try {
      const pkgDef = moddle.getPackage?.(pkg) ?? moddle.registry?.packageMap?.[pkg];
      if (pkgDef?.enumerations?.some((e: any) => e.name === name)) {
        return 'Enum';
      }
    } catch { /* not an enum */ }
  }

  switch (propertyType) {
    case 'Boolean':
      return 'Boolean';
    case 'studyflow:Schema':
    case 'studyflow:MarkdownString':
    case 'studyflow:YAMLString':
      return 'Markdown';
    default:
      return 'String';
  }
}

export function PropertyField({ bpmnProperty, businessObject, elementId }: PropertyFieldProps) {
  const doc = useModelerStore((s) => s.document);
  const moddle = doc?.getModdle();
  const [isVisible] = useState(() => isPropertyVisible(bpmnProperty, businessObject));

  if (!isVisible) return null;

  const genericType = resolveGenericType(bpmnProperty, moddle);

  const sharedProps = { bpmnProperty, businessObject, elementId };

  return (
    <Field className="mx-2 pb-2">
      {genericType === 'Boolean' && <BooleanInput {...sharedProps} />}
      {genericType === 'Enum' && <EnumInput {...sharedProps} />}
      {genericType === 'Markdown' && <StringInput {...sharedProps} isMarkdown />}
      {genericType === 'String' && <StringInput {...sharedProps} />}
    </Field>
  );
}
